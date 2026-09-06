import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// App de teste manual das features do My DevTools (não é o app final). Cada
// feature nova ganha sua própria página aqui, com botões que descrevem o que
// testam — a página some quando a feature correspondente sai do roadmap ou
// vira redundante.

function HomeScreen({ onSelect }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My DevTools — páginas de teste</Text>
      <Pressable style={styles.button} onPress={() => onSelect('console')}>
        <Text style={styles.buttonText}>Console (log / warn / error / exceção)</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => onSelect('debugger')}>
        <Text style={styles.buttonText}>Debugger (breakpoint / step / escopo)</Text>
      </Pressable>
    </View>
  );
}

function BackButton({ onPress }) {
  return (
    <Pressable style={styles.backButton} onPress={onPress}>
      <Text style={styles.buttonText}>{'< Voltar'}</Text>
    </Pressable>
  );
}

function ConsoleScreen({ onBack }) {
  let count = 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Teste: Console</Text>

      <Pressable
        style={styles.button}
        onPress={() => console.log(`log #${++count} às ${new Date().toLocaleTimeString()}`)}
      >
        <Text style={styles.buttonText}>console.log</Text>
      </Pressable>

      <Pressable style={styles.button} onPress={() => console.warn(`warn #${++count}`)}>
        <Text style={styles.buttonText}>console.warn</Text>
      </Pressable>

      <Pressable style={styles.button} onPress={() => console.error(`error #${++count}`)}>
        <Text style={styles.buttonText}>console.error</Text>
      </Pressable>

      <Pressable
        style={styles.button}
        onPress={() => {
          throw new Error(`exceção não tratada #${++count}`);
        }}
      >
        <Text style={styles.buttonText}>throw (exceção)</Text>
      </Pressable>

      <BackButton onPress={onBack} />
    </View>
  );
}

// Função de teste do painel Debugger: ponha um breakpoint na linha do
// `const doubled` (linha 73 deste arquivo) antes de apertar o botão — o
// debugger deve pausar ali com `a`, `b`, `sum` visíveis no escopo local.
function computeSomething(a, b) {
  const sum = a + b;
  const doubled = sum * 2;
  const label = `resultado: ${doubled}`;
  console.log(label);
  return doubled;
}

function DebuggerScreen({ onBack }) {
  const [result, setResult] = useState(null);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Teste: Debugger</Text>
      <Text style={styles.hint}>
        Ponha um breakpoint em App.js, linha do "const doubled" (linha 73) antes de
        clicar.
      </Text>

      <Pressable style={styles.button} onPress={() => setResult(computeSomething(2, 3))}>
        <Text style={styles.buttonText}>Rodar função com variáveis locais</Text>
      </Pressable>

      {result !== null && <Text style={styles.hint}>Resultado: {result}</Text>}

      <BackButton onPress={onBack} />
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState('home');

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {screen === 'home' && <HomeScreen onSelect={setScreen} />}
      {screen === 'console' && <ConsoleScreen onBack={() => setScreen('home')} />}
      {screen === 'debugger' && <DebuggerScreen onBack={() => setScreen('home')} />}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 48,
  },
  title: {
    marginBottom: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    maxWidth: 260,
    textAlign: 'center',
    fontSize: 13,
    color: '#52525b',
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 6,
    backgroundColor: '#e4e4e7',
  },
  backButton: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 6,
    backgroundColor: '#d4d4d8',
  },
  buttonText: {
    fontSize: 14,
  },
});
