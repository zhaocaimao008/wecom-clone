import { useState } from 'react';
import { useStore } from '../store/useStore';

const LIMITS = {
  voice: 10 * 1024 * 1024,  // 10MB
  image: 20 * 1024 * 1024,  // 20MB
  file:  50 * 1024 * 1024,  // 50MB
};

export function useUpload(activeConv) {
  const [uploading, setUploading] = useState(false);

  function convParams() {
    if (!activeConv) return null;
    return activeConv.type === 'private'
      ? { field: 'receiverId', value: activeConv.id }
      : { field: 'groupId',   value: activeConv.id };
  }

  function sizeGuard(size, limit, label) {
    if (size > limit) {
      useStore.getState().addToast({ title: '文件过大', body: `${label}不能超过 ${limit / 1024 / 1024}MB` });
      return false;
    }
    return true;
  }

  async function uploadVoice(blob, durationMs, replyToId) {
    const p = convParams();
    if (!p) return;
    if (!sizeGuard(blob.size, LIMITS.voice, '语音')) return;
    const token = useStore.getState().token;
    const form = new FormData();
    form.append('audio', blob, `voice-${Date.now()}.webm`);
    form.append('durationMs', durationMs);
    form.append(p.field, p.value);
    if (replyToId) form.append('replyToId', replyToId);
    try {
      const res = await fetch('/api/messages/voice', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const msg = await res.json();
      if (res.ok) useStore.getState().addMessage({ ...msg, type: 'voice' });
      else useStore.getState().addToast({ title: '发送失败', body: msg.error || '语音上传失败' });
    } catch {
      useStore.getState().addToast({ title: '发送失败', body: '语音上传失败，请检查网络' });
    }
  }

  async function uploadImage(file, replyToId) {
    const p = convParams();
    if (!p) return;
    if (!sizeGuard(file.size, LIMITS.image, '图片')) return;
    const form = new FormData();
    form.append('image', file);
    form.append(p.field, p.value);
    if (replyToId) form.append('replyToId', replyToId);
    try {
      const res = await fetch('/api/messages/image', {
        method: 'POST', headers: { Authorization: `Bearer ${useStore.getState().token}` }, body: form,
      });
      const msg = await res.json();
      if (res.ok) useStore.getState().addMessage({ ...msg, type: 'image' });
      else useStore.getState().addToast({ title: '发送失败', body: msg.error || '图片上传失败' });
    } catch {
      useStore.getState().addToast({ title: '发送失败', body: '图片上传失败，请检查网络' });
    }
  }

  async function uploadFile(file, replyToId) {
    const p = convParams();
    if (!p) return;
    if (!sizeGuard(file.size, LIMITS.file, '文件')) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append(p.field, p.value);
    if (replyToId) form.append('replyToId', replyToId);
    try {
      const res = await fetch('/api/messages/file', {
        method: 'POST', headers: { Authorization: `Bearer ${useStore.getState().token}` }, body: form,
      });
      const msg = await res.json();
      if (res.ok) useStore.getState().addMessage({ ...msg, type: 'file' });
      else useStore.getState().addToast({ title: '发送失败', body: msg.error || '文件发送失败' });
    } catch {
      useStore.getState().addToast({ title: '发送失败', body: '文件发送失败，请检查网络' });
    } finally {
      setUploading(false);
    }
  }

  return { uploading, uploadVoice, uploadImage, uploadFile };
}
