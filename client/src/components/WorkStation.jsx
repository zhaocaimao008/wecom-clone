import React from 'react';

const APPS = [
  { name: '审批', icon: '📋', color: '#576b95', desc: '流程审批' },
  { name: '打卡', icon: '⏰', color: '#07c160', desc: '考勤打卡' },
  { name: '日程', icon: '📅', color: '#fa9d3b', desc: '日程管理' },
  { name: '汇报', icon: '📊', color: '#e64340', desc: '工作汇报' },
  { name: '公告', icon: '📢', color: '#10aec2', desc: '公司公告' },
  { name: '文件', icon: '📁', color: '#576b95', desc: '文件管理' },
  { name: '任务', icon: '✅', color: '#07c160', desc: '任务管理' },
  { name: '邮件', icon: '✉️', color: '#fa9d3b', desc: '企业邮箱' },
  { name: '会议', icon: '🎥', color: '#e64340', desc: '视频会议' },
  { name: '知识库', icon: '📚', color: '#10aec2', desc: '企业知识库' },
  { name: '报销', icon: '💰', color: '#576b95', desc: '费用报销' },
  { name: '名片', icon: '🪪', color: '#07c160', desc: '电子名片' },
];

const NOTICES = [
  { id: 1, title: '关于本周五全员大会的通知', time: '10:00', dept: '人事部', unread: true },
  { id: 2, title: '2024年Q1绩效评估开始', time: '昨天', dept: '人事部', unread: true },
  { id: 3, title: '新版费用报销系统上线', time: '周一', dept: '财务部', unread: false },
  { id: 4, title: '办公室空调维修通知', time: '上周', dept: '行政部', unread: false },
];

export default function WorkStation() {
  return (
    <div className="workstation">
      <div className="workstation-inner">
        <section className="ws-section">
          <h3 className="ws-title">常用应用</h3>
          <div className="app-grid">
            {APPS.map(app => (
              <button key={app.name} className="app-item">
                <div className="app-icon" style={{ background: app.color }}>{app.icon}</div>
                <span className="app-name">{app.name}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ws-section">
          <h3 className="ws-title">企业公告</h3>
          <div className="notice-list">
            {NOTICES.map(n => (
              <div key={n.id} className="notice-item">
                <div className="notice-dot-wrap">
                  {n.unread && <span className="notice-dot" />}
                </div>
                <div className="notice-content">
                  <span className="notice-title">{n.title}</span>
                  <span className="notice-meta">{n.dept} · {n.time}</span>
                </div>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="#ccc"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
              </div>
            ))}
          </div>
        </section>

        <section className="ws-section">
          <h3 className="ws-title">待办事项</h3>
          <div className="todo-list">
            {[
              { text: '审批：王五的请假申请', urgent: true, time: '今天 14:00' },
              { text: '完成本周代码review', urgent: false, time: '今天 18:00' },
              { text: '提交Q1季度报告', urgent: true, time: '明天 09:00' },
              { text: '参加产品需求评审会议', urgent: false, time: '明天 14:00' },
            ].map((t, i) => (
              <div key={i} className="todo-item">
                <input type="checkbox" />
                <div className="todo-content">
                  <span className="todo-text">{t.text}</span>
                  <span className={`todo-time ${t.urgent ? 'urgent' : ''}`}>{t.time}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
