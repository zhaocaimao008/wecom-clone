import React from 'react';

export default function WorkStation() {
  return (
    <div className="workstation">
      <div className="workstation-inner" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: 40 }}>
        <svg viewBox="0 0 80 80" width="72" height="72" fill="none">
          <circle cx="40" cy="40" r="40" fill="var(--hover-bg)"/>
          <path d="M24 52V32a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v20M20 52h40" stroke="var(--text-hint)" strokeWidth="2.5" strokeLinecap="round"/>
          <path d="M34 40h12M34 46h8" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>工作台</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.7 }}>
          审批、打卡、日程、汇报等企业应用<br/>正在建设中，敬请期待
        </div>
      </div>
    </div>
  );
}
