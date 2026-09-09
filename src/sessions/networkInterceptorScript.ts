// Script injetado no runtime do app via `Runtime.evaluate` (mesmo mecanismo do
// REPL/M2) logo que a conexão CDP abre. Intercepta `fetch`/`XMLHttpRequest` e
// reporta cada request/response/erro via `console.debug`, prefixado por
// `NETWORK_EVENT_MARKER` — reusa o canal `Runtime.consoleAPICalled`, que já é
// comprovadamente estável neste projeto (painel Console), em vez de depender
// do domínio CDP `Network` (não há garantia de que o Hermes/Metro do RN o
// implemente pra fetch/XHR do app — é uma feature do Chrome, não do motor JS).
//
// Efeito colateral aceito: requests nativos (Image, native modules) não usam
// `fetch`/`XMLHttpRequest` do JS, então não aparecem aqui — limitação
// documentada no ROADMAP.md, não um bug.
//
// Idempotente (`__myDevToolsNetworkPatched`): `ensureConnection` pode rodar
// este script mais de uma vez ao longo da vida do app (reconexão) — sem a
// guarda, o fetch acabaria interceptado várias vezes em cascata.
//
// `fetchDepth`: o `fetch` do React Native é implementado por cima de
// `XMLHttpRequest` (a própria polyfill do RN cria uma XHR internamente pra
// fazer a chamada de verdade). Sem essa guarda, toda `fetch()` dispara os DOIS
// interceptors — o de fetch e o de XHR — pra uma única requisição real,
// gerando uma segunda linha fantasma no painel (e essa XHR interna usa
// `responseType: 'blob'`, então ler `responseText` nela lança exceção e a
// linha fica travada pra sempre sem status/body). `fetchDepth` marca a XHR
// aberta durante a execução síncrona de `fetch` como interna e pula o report
// dela — ela continua funcionando normalmente, só não vira uma entrada.

export const NETWORK_EVENT_MARKER = '__MY_DEVTOOLS_NETWORK__'

const MAX_BODY_LENGTH = 10000

export const NETWORK_INTERCEPTOR_SCRIPT = `
(function () {
  // O valor de retorno vira o completion value do Runtime.evaluate — dá pra
  // quem reenvia este script (ver \`reinstallNetworkInterceptor\` no
  // SessionManager) saber se instalou de novo (contexto era novo) ou só bateu
  // na guarda (contexto seguia com o patch de antes).
  if (globalThis.__myDevToolsNetworkPatched) return false;
  globalThis.__myDevToolsNetworkPatched = true;

  var MARKER = ${JSON.stringify(NETWORK_EVENT_MARKER)};
  var MAX_BODY = ${MAX_BODY_LENGTH};
  var counter = 0;
  var fetchDepth = 0;

  function report(event) {
    try {
      console.debug(MARKER + JSON.stringify(event));
    } catch (e) {}
  }

  function truncate(text) {
    if (typeof text !== 'string') return undefined;
    return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + '…' : text;
  }

  function headersToObject(headers) {
    var result = {};
    try {
      if (!headers) return result;
      if (typeof headers.forEach === 'function') {
        headers.forEach(function (value, key) { result[key] = value; });
      } else {
        Object.keys(headers).forEach(function (key) { result[key] = headers[key]; });
      }
    } catch (e) {}
    return result;
  }

  var originalFetch = globalThis.fetch;
  if (originalFetch) {
    globalThis.fetch = function (input, init) {
      var id = 'f' + (++counter) + '-' + Date.now();
      var method = (init && init.method) || (input && input.method) || 'GET';
      var url = typeof input === 'string' ? input : (input && input.url) || String(input);
      var headers = headersToObject((init && init.headers) || (input && input.headers));
      var body = init && init.body;

      report({
        kind: 'request',
        id: id,
        type: 'fetch',
        method: method,
        url: url,
        headers: headers,
        body: typeof body === 'string' ? truncate(body) : undefined,
        startTime: Date.now()
      });

      var promise;
      fetchDepth++;
      try {
        promise = originalFetch.apply(this, arguments);
      } finally {
        fetchDepth--;
      }

      return promise.then(
        function (response) {
          var respHeaders = headersToObject(response.headers);
          var contentType = respHeaders['content-type'] || respHeaders['Content-Type'] || '';
          var readable = /^(text\\/|application\\/json)/.test(contentType);
          if (readable) {
            response
              .clone()
              .text()
              .then(function (text) {
                report({ kind: 'response', id: id, status: response.status, headers: respHeaders, body: truncate(text), endTime: Date.now() });
              })
              .catch(function () {
                report({ kind: 'response', id: id, status: response.status, headers: respHeaders, endTime: Date.now() });
              });
          } else {
            report({ kind: 'response', id: id, status: response.status, headers: respHeaders, endTime: Date.now() });
          }
          return response;
        },
        function (error) {
          report({ kind: 'error', id: id, message: String((error && error.message) || error), endTime: Date.now() });
          throw error;
        }
      );
    };
  }

  var OriginalXHR = globalThis.XMLHttpRequest;
  if (OriginalXHR) {
    var originalOpen = OriginalXHR.prototype.open;
    var originalSend = OriginalXHR.prototype.send;
    var originalSetHeader = OriginalXHR.prototype.setRequestHeader;

    OriginalXHR.prototype.open = function (method, url) {
      // Se estamos dentro da execução síncrona de um fetch(), esta XHR é a
      // que o próprio RN usa por baixo dos panos — não é uma chamada do app.
      this.__myDevToolsSkip = fetchDepth > 0;
      this.__myDevToolsMethod = method;
      this.__myDevToolsUrl = url;
      this.__myDevToolsHeaders = {};
      return originalOpen.apply(this, arguments);
    };

    OriginalXHR.prototype.setRequestHeader = function (name, value) {
      if (this.__myDevToolsHeaders) this.__myDevToolsHeaders[name] = value;
      return originalSetHeader.apply(this, arguments);
    };

    OriginalXHR.prototype.send = function (body) {
      if (this.__myDevToolsSkip) return originalSend.apply(this, arguments);

      var id = 'x' + (++counter) + '-' + Date.now();
      var self = this;

      report({
        kind: 'request',
        id: id,
        type: 'xhr',
        method: this.__myDevToolsMethod || 'GET',
        url: this.__myDevToolsUrl || '',
        headers: this.__myDevToolsHeaders || {},
        body: typeof body === 'string' ? truncate(body) : undefined,
        startTime: Date.now()
      });

      this.addEventListener('loadend', function () {
        var respHeaders = {};
        try {
          var raw = self.getAllResponseHeaders() || '';
          raw.split('\\r\\n').forEach(function (line) {
            var index = line.indexOf(':');
            if (index > 0) respHeaders[line.slice(0, index).trim()] = line.slice(index + 1).trim();
          });
        } catch (e) {}
        report({
          kind: 'response',
          id: id,
          status: self.status,
          headers: respHeaders,
          body: typeof self.responseText === 'string' ? truncate(self.responseText) : undefined,
          endTime: Date.now()
        });
      });

      return originalSend.apply(this, arguments);
    };
  }

  return true;
})();
`
