import React, { useState, useEffect } from 'react';

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const isFrameless = !!window.electronAPI?.framelessChrome;

  useEffect(() => {
    if (!isFrameless) return;
    window.electronAPI.isMaximized().then(setMaximized);
  }, [isFrameless]);

  // Only render on Windows Electron (frameless chrome)
  if (!isFrameless) return null;

  async function toggleMaximize() {
    await window.electronAPI.maximizeWindow();
    const m = await window.electronAPI.isMaximized();
    setMaximized(m);
  }

  return (
    <div className="app-titlebar">
      {/* Draggable region */}
      <div className="app-titlebar-drag">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
          <rect width="24" height="24" rx="5" fill="#07c160"/>
          <path d="M9 6c-3 0-5.5 2-5.5 4.5 0 1.3.7 2.5 1.8 3.3l-.6 1.9 2.1-1c.5.1 1.1.2 1.7.2 3 0 5.5-2 5.5-4.5S12 6 9 6z" fill="white" opacity=".95"/>
          <path d="M17 9.5c-2.5 0-4.5 1.7-4.5 3.7 0 1.1.6 2.1 1.5 2.8l-.6 1.7 1.9-.9c.4.1.9.2 1.7.2 2.5 0 4.5-1.7 4.5-3.7S19.5 9.5 17 9.5z" fill="white"/>
        </svg>
        <span className="app-titlebar-name">密信</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>v{__APP_VERSION__}</span>
      </div>

      {/* Window control buttons */}
      <div className="app-titlebar-btns">
        {/* Minimize */}
        <button
          className="app-titlebar-btn"
          title="最小化"
          onClick={() => window.electronAPI.minimizeWindow()}
        >
          <svg viewBox="0 0 10 1" width="10" height="1" fill="currentColor">
            <rect width="10" height="1"/>
          </svg>
        </button>

        {/* Maximize / Restore */}
        <button
          className="app-titlebar-btn"
          title={maximized ? '还原' : '最大化'}
          onClick={toggleMaximize}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="8" height="8"/>
              <rect x="0" y="2" width="8" height="8" fill="var(--titlebar-bg)"/>
              <rect x="0" y="2" width="8" height="8"/>
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0" y="0" width="10" height="10"/>
            </svg>
          )}
        </button>

        {/* Close */}
        <button
          className="app-titlebar-btn app-titlebar-btn-close"
          title="关闭"
          onClick={() => window.electronAPI.closeWindow()}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor">
            <path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
