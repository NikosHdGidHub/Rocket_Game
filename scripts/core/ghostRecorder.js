/* ================================================================
   ghostRecorder.js — запись текущего полёта для призрака.
================================================================ */
import * as CFG from '../config.js'
import { rocketState, time, ghostRecorder, runtime } from '../state.js'
import * as Abilities from '../abilities.js'

export function startGhostRecording() {
  ghostRecorder.samples.length = 0
  ghostRecorder.recording = true
  ghostRecorder.startTime = time.gameTime
  ghostRecorder.nextSampleTime = 0
}

export function recordGhostSample() {
  const rec = ghostRecorder
  if (!rec.recording) return

  const elapsed = time.gameTime - rec.startTime
  if (elapsed >= CFG.ROCKET.recordingTimeLimit) {
    rec.recording = false
    return
  }
  if (elapsed < rec.nextSampleTime) return

  rec.nextSampleTime += 1 / CFG.ROCKET.recordingFPS

  rec.samples.push(
    elapsed,
    rocketState.pos.x,
    rocketState.pos.y,
    rocketState.pos.z,
    rocketState.rotZ,
    runtime.boosting || Abilities.isActive('forsage') ? 1 : 0
  )
}
