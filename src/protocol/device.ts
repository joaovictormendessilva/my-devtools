// Contrato central do sistema (ver ARCHITECTURE.md §5). Toda camada que fala de
// "dispositivo" usa este tipo — nunca uma cópia local dentro de uma feature.
export interface Device {
  /** `reactNative.logicalDeviceId` reportado pelo Metro. */
  id: string
  name: string
  // `platform` fica indefinido na descoberta: o endpoint /json/list do Metro não
  // expõe a plataforma de forma confiável. Preenchido quando houver conexão real
  // ao runtime (passo futuro do M1).
  platform?: 'ios' | 'android'
  model?: string
  osVersion?: string
  expoSdk?: string
  reactNativeVersion?: string
  runtime?: string
  status: 'connected' | 'available' | 'offline'
}
