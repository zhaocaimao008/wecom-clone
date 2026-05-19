import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';

const MAX_RECORD_MS = 60_000; // 60-second cap

export function useVoiceRecorder(onDone) {
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const mediaRecorderRef = useRef(null);
  const intervalRef = useRef(null);
  const autoStopRef = useRef(null);
  const elapsedRef = useRef(0);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mediaRecorderRef.current = mr;
      elapsedRef.current = 0;

      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(intervalRef.current);
        clearTimeout(autoStopRef.current);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        const dur = elapsedRef.current;
        setRecordMs(0);
        setRecording(false);
        await onDoneRef.current(blob, dur);
      };

      mr.start();
      setRecording(true);
      setRecordMs(0);
      intervalRef.current = setInterval(() => {
        elapsedRef.current += 100;
        setRecordMs(ms => ms + 100);
      }, 100);
      // Auto-stop at 60 seconds
      autoStopRef.current = setTimeout(() => {
        useStore.getState().addToast({ title: '已达最大录音时长', body: '录音已自动发送（60秒）' });
        mr.stop();
      }, MAX_RECORD_MS);
    } catch {
      useStore.getState().addToast({ title: '无法录音', body: '请检查麦克风权限' });
    }
  }

  function stop() {
    clearTimeout(autoStopRef.current);
    mediaRecorderRef.current?.stop();
  }

  return { recording, recordMs, start, stop };
}
