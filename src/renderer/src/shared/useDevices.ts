import { useEffect, useState } from 'react'
import type { Device } from '../../../protocol/device'

const POLL_INTERVAL_MS = 2000

// Enquanto o main não empurra um evento quando a lista muda (passo futuro do M1),
// o renderer pergunta periodicamente. O polling real do Metro acontece no
// DeviceManager (processo main); aqui só lemos o resultado dele.
export function useDevices(): Device[] {
  const [devices, setDevices] = useState<Device[]>([])

  useEffect(() => {
    let active = true

    const load = async (): Promise<void> => {
      const next = await window.api.listDevices()
      if (active) setDevices(next)
    }

    void load()
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])

  return devices
}
