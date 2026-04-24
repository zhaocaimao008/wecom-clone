import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getSocket } from '../socket';
import { AvatarCircle } from './Sidebar';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

// Hook for ChatWindow to start a call
export function useCall() {
  const { setActiveCall, currentUser } = useStore();
  return useCallback((targetId, targetName, targetColor, callType) => {
    setActiveCall({ state: 'outgoing', peerId: targetId, peerName: targetName, peerColor: targetColor, callType });
  }, [setActiveCall]);
}

export default function CallScreen() {
  const { activeCall, setActiveCall, clearCall, currentUser } = useStore();
  const socket = getSocket();

  const localRef  = useRef(null);
  const remoteRef = useRef(null);
  const pcRef     = useRef(null);
  const streamRef = useRef(null);

  const [muted, setMuted]     = useState(false);
  const [camOff, setCamOff]   = useState(false);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef(null);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    window.__peerConn = null;
    streamRef.current = null;
    setDuration(0);
    setMuted(false);
    setCamOff(false);
  }

  function endCall(targetId) {
    if (socket && targetId) socket.emit('call_end', { targetId });
    cleanup();
    clearCall();
  }

  function rejectCall(targetId) {
    if (socket && targetId) socket.emit('call_reject', { targetId });
    cleanup();
    clearCall();
  }

  async function createPC(targetId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    window.__peerConn = pc;

    pc.onicecandidate = e => {
      if (e.candidate && socket) socket.emit('call_ice', { targetId, candidate: e.candidate });
    };

    pc.ontrack = e => {
      if (remoteRef.current) remoteRef.current.srcObject = e.streams[0];
    };

    return pc;
  }

  async function getMedia(callType) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('浏览器不支持音视频通话，请使用 HTTPS 访问或使用 Chrome/Edge 浏览器');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === 'video',
    });
    streamRef.current = stream;
    if (localRef.current) localRef.current.srcObject = stream;
    return stream;
  }

  // ── Outgoing call ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeCall || activeCall.state !== 'outgoing') return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await getMedia(activeCall.callType);
        if (cancelled) return stream.getTracks().forEach(t => t.stop());

        const pc = await createPC(activeCall.peerId);
        stream.getTracks().forEach(t => pc.addTrack(t, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket?.emit('call_offer', { targetId: activeCall.peerId, offer, callType: activeCall.callType });
      } catch (e) {
        if (!cancelled) {
          alert(e.message?.includes('HTTPS') || !navigator.mediaDevices
            ? e.message
            : '无法获取麦克风/摄像头权限，请检查浏览器设置');
          cleanup(); clearCall();
        }
      }
    })();

    return () => { cancelled = true; };
  }, [activeCall?.state === 'outgoing' ? activeCall.peerId : null]);

  // ── Incoming: auto-answer when accepted ───────────────────────────────────
  useEffect(() => {
    if (!activeCall || activeCall.state !== 'incoming') return;

    // If another call is already in progress, send busy
    if (pcRef.current) {
      socket?.emit('call_busy', { targetId: activeCall.callerId });
      clearCall();
    }
  }, [activeCall?.state === 'incoming' ? activeCall.callerId : null]);

  async function acceptCall() {
    if (!activeCall) return;
    try {
      const stream = await getMedia(activeCall.callType);
      const pc = await createPC(activeCall.callerId);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(activeCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket?.emit('call_answer', { targetId: activeCall.callerId, answer });

      setActiveCall({ ...activeCall, state: 'active', peerId: activeCall.callerId });
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch (e) {
      alert('无法获取麦克风/摄像头权限');
      rejectCall(activeCall.callerId);
    }
  }

  // ── Handle answered (caller side) ────────────────────────────────────────
  useEffect(() => {
    if (!activeCall || activeCall.state !== 'active' || !activeCall.answer || !pcRef.current) return;
    pcRef.current.setRemoteDescription(new RTCSessionDescription(activeCall.answer)).catch(() => {});
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [activeCall?.state]);

  // ── Watch for ended/rejected ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeCall) return;
    if (activeCall.state === 'ended' || activeCall.state === 'rejected' || activeCall.state === 'busy') {
      setTimeout(() => { cleanup(); clearCall(); }, 800);
    }
  }, [activeCall?.state]);

  // ── Mute / camera ─────────────────────────────────────────────────────────
  function toggleMute() {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(t => t.enabled = muted);
    setMuted(v => !v);
  }

  function toggleCam() {
    if (!streamRef.current) return;
    streamRef.current.getVideoTracks().forEach(t => t.enabled = camOff);
    setCamOff(v => !v);
  }

  function fmtDuration(s) {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  if (!activeCall) return null;

  const isVideo = activeCall.callType === 'video';
  const peerId    = activeCall.peerId || activeCall.callerId;
  const peerName  = activeCall.peerName  || activeCall.callerName  || '对方';
  const peerColor = activeCall.peerColor || activeCall.callerColor || '#07c160';

  // ── Incoming overlay ──────────────────────────────────────────────────────
  if (activeCall.state === 'incoming') {
    return (
      <div className="call-overlay">
        <div className="call-box incoming">
          <div className="call-type-label">{isVideo ? '视频通话' : '语音通话'}邀请</div>
          <AvatarCircle name={peerName} color={peerColor} size={80} radius={40} />
          <div className="call-peer-name">{peerName}</div>
          <div className="call-status">邀请你进行{isVideo ? '视频' : '语音'}通话</div>
          <div className="call-actions">
            <button className="call-btn reject" onClick={() => rejectCall(activeCall.callerId)}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.12-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
              <span>拒绝</span>
            </button>
            <button className="call-btn accept" onClick={acceptCall}>
              {isVideo
                ? <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                : <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.01L6.6 10.8z"/></svg>
              }
              <span>接听</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Outgoing / calling ────────────────────────────────────────────────────
  if (activeCall.state === 'outgoing') {
    return (
      <div className="call-overlay">
        <div className="call-box outgoing">
          <div className="call-type-label">{isVideo ? '视频通话' : '语音通话'}</div>
          <AvatarCircle name={peerName} color={peerColor} size={80} radius={40} />
          <div className="call-peer-name">{peerName}</div>
          <div className="call-status call-ringing">等待对方接听<span className="call-dots"><span/><span/><span/></span></div>
          <div className="call-actions">
            <button className="call-btn reject" onClick={() => endCall(peerId)}>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.12-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
              <span>取消</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Status screens ────────────────────────────────────────────────────────
  if (['rejected', 'ended', 'busy'].includes(activeCall.state)) {
    const labels = { rejected: '对方已拒绝', ended: '通话已结束', busy: '对方正忙' };
    return (
      <div className="call-overlay">
        <div className="call-box outgoing">
          <AvatarCircle name={peerName} color={peerColor} size={80} radius={40} />
          <div className="call-peer-name">{peerName}</div>
          <div className="call-status">{labels[activeCall.state]}</div>
        </div>
      </div>
    );
  }

  // ── Active call ───────────────────────────────────────────────────────────
  return (
    <div className={`call-overlay ${isVideo ? 'call-video-mode' : ''}`}>
      <div className="call-box active">
        {isVideo && (
          <div className="video-area">
            <video ref={remoteRef} autoPlay playsInline className="video-remote" />
            <video ref={localRef}  autoPlay playsInline muted className="video-local" />
          </div>
        )}
        {!isVideo && (
          <div className="audio-call-info">
            <AvatarCircle name={peerName} color={peerColor} size={96} radius={48} />
            <div className="call-peer-name">{peerName}</div>
          </div>
        )}
        <div className="call-timer">{fmtDuration(duration)}</div>
        <div className="call-controls">
          <button className={`ctrl-btn ${muted ? 'active' : ''}`} onClick={toggleMute} title={muted ? '取消静音' : '静音'}>
            {muted
              ? <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>
              : <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/></svg>
            }
            <span>{muted ? '取消静音' : '静音'}</span>
          </button>

          {isVideo && (
            <button className={`ctrl-btn ${camOff ? 'active' : ''}`} onClick={toggleCam} title={camOff ? '开启摄像头' : '关闭摄像头'}>
              {camOff
                ? <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M21 6.5l-4-4-5 5-3-3L4 9v8h.12L1 20l1.39 1.39L21 3.89 21 6.5zm-11 11L7 14.5V11l3 3v3.5zm.5-9L13 6h1.5l4 4-3.71 3.71-4.29-4.21zM19 17l-8-8v8h8z"/></svg>
                : <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              }
              <span>{camOff ? '开摄像头' : '关摄像头'}</span>
            </button>
          )}

          <button className="ctrl-btn end" onClick={() => endCall(peerId)}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.12-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>
            <span>挂断</span>
          </button>
        </div>
      </div>
    </div>
  );
}
