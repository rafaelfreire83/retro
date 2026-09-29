import { useEffect, useState } from 'react'

export const endsAt = (timer) => timer.startedAt.toMillis() + timer.durationSec * 1000

export function timerPhase(timer, now) {
  if (!timer.startedAt) return 'waiting'
  if (timer.stopped) return 'ended'
  return now < endsAt(timer) ? 'running' : 'ended'
}

export const PHASE_LABEL = {
  waiting: 'Aguardando o início',
  running: 'Tempo restante',
  ended: 'Tempo encerrado',
}

export function formatTime(totalSec) {
  const sec = Math.max(0, Math.ceil(totalSec))
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
