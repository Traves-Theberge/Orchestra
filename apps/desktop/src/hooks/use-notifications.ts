import { useState } from 'react'

type NotificationState = {
  notifSound: string
  setNotifSound: (sound: string) => void
  notifMuted: boolean
  setNotifMuted: (muted: boolean) => void
  notifVolume: number
  setNotifVolume: (volume: number) => void
  playNotification: (issueIdentifier: string) => void
}

/**
 * Manages notification preferences (persisted in localStorage) and
 * provides a helper to play the configured notification sound.
 */
export function useNotifications(): NotificationState {
  const [notifSound, setNotifSoundRaw] = useState(
    () => localStorage.getItem('orchestra_notif_sound') || 'chime'
  )
  const [notifMuted, setNotifMutedRaw] = useState(
    () => localStorage.getItem('orchestra_notif_muted') === 'true'
  )
  const [notifVolume, setNotifVolumeRaw] = useState(
    () => parseFloat(localStorage.getItem('orchestra_notif_volume') || '0.3')
  )

  const setNotifSound = (sound: string) => {
    setNotifSoundRaw(sound)
    localStorage.setItem('orchestra_notif_sound', sound)
  }

  const setNotifMuted = (muted: boolean) => {
    setNotifMutedRaw(muted)
    localStorage.setItem('orchestra_notif_muted', String(muted))
  }

  const setNotifVolume = (volume: number) => {
    setNotifVolumeRaw(volume)
    localStorage.setItem('orchestra_notif_volume', String(volume))
  }

  const playNotification = (issueIdentifier: string) => {
    if (notifMuted) return

    // Play audio notification
    try {
      const ctx = new AudioContext()
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(notifVolume, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)

      if (notifSound === 'bell') {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.connect(gain)
        osc.frequency.setValueAtTime(1047, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(523, ctx.currentTime + 0.3)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.5)
        osc.onended = () => ctx.close()
      } else if (notifSound === 'pulse') {
        const osc = ctx.createOscillator()
        osc.type = 'square'
        osc.connect(gain)
        osc.frequency.setValueAtTime(440, ctx.currentTime)
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.05)
        osc.frequency.setValueAtTime(0, ctx.currentTime + 0.1)
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.15)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.3)
        osc.onended = () => ctx.close()
      } else {
        // Default: chime (ascending tones)
        const osc = ctx.createOscillator()
        osc.connect(gain)
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1)
        osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.2)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.4)
        osc.onended = () => ctx.close()
      }
    } catch { /* ignore audio errors */ }

    // Show browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Agent Completed', {
        body: `${issueIdentifier} has been moved to Review.`,
        icon: './favicon.ico',
      })
    } else if ('Notification' in window && Notification.permission !== 'denied') {
      void Notification.requestPermission()
    }
  }

  return {
    notifSound, setNotifSound,
    notifMuted, setNotifMuted,
    notifVolume, setNotifVolume,
    playNotification,
  }
}
