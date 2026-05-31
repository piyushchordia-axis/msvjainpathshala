// Atomic components for the Next.js admin UI kit.
// Exposes: AdminIcon, Sidebar, StatsCard, StatusBadge, Pill, AgePill, TierBadge,
// DataTable, TextField, SelectField, DateField, FileField, Avatar, Topbar.

const { useState } = React;

function AdminIcon({ name, size = 18, color = 'currentColor', fill = 'none' }) {
  const P = { strokeWidth: 1.8, strokeLinecap:'round', strokeLinejoin:'round',
    stroke: fill==='none' ? color : 'none', fill: fill==='none' ? 'none' : color };
  const paths = {
    grid:   <g><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></g>,
    users:  <g><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></g>,
    home:   <g><path d="M3 9 12 3l9 6v12H3V9Z"/><path d="M9 21V12h6v9"/></g>,
    bell:   <g><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></g>,
    lotus:  <path d="M12 2 9 9H2l5.5 4-2 7L12 16l6.5 4-2-7L22 9h-7Z"/>,
    file:   <g><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></g>,
    settings: <g><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.3 7.2l-.1-.1A2 2 0 1 1 7 4.3l.1.1A1.7 1.7 0 0 0 9 4.7 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></g>,
    search: <g><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>,
    chevron:<path d="m6 9 6 6 6-6"/>,
    chevronUp: <path d="m18 15-6-6-6 6"/>,
    arrowUp:<path d="M12 19V5M5 12l7-7 7 7"/>,
    arrowDn:<path d="M12 5v14M5 12l7 7 7-7"/>,
    plus:   <path d="M12 5v14M5 12h14"/>,
    more:   <g><circle cx="5" cy="12" r="1.5" fill={color} stroke="none"/><circle cx="12" cy="12" r="1.5" fill={color} stroke="none"/><circle cx="19" cy="12" r="1.5" fill={color} stroke="none"/></g>,
    upload: <g><path d="M12 16V4M5 11l7-7 7 7"/><path d="M20 20H4"/></g>,
    calendar: <g><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></g>,
    filter: <path d="M3 5h18M6 12h12M10 19h4"/>,
    download: <g><path d="M12 4v12M5 13l7 7 7-7"/><path d="M20 20H4"/></g>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" {...P}>{paths[name]}</svg>;
}

function Avatar({ initials = 'A', size = 32, gradient = true }) {
  return <div style={{
    width:size, height:size, borderRadius:'50%', flexShrink:0,
    background: gradient ? `linear-gradient(135deg, ${JP.saffron300}, ${JP.saffron})` : JP.creamDark,
    color: gradient ? '#FFFFFF' : JP.maroon,
    display:'flex', alignItems:'center', justifyContent:'center',
    fontFamily: JP.body, fontWeight:700, fontSize: size * 0.36,
  }}>{initials}</div>;
}

// ───────────────── Sidebar ─────────────────
function Sidebar({ active, onChange, role = 'cityAdmin' }) {
  const itemsByRole = {
    cityAdmin: [
      { k:'dashboard', label:'Dashboard',     icon:'grid' },
      { k:'students',  label:'Students',      icon:'users', badge:'1,248' },
      { k:'centres',   label:'Centres',       icon:'home', badge:14 },
      { k:'notices',   label:'Notices',       icon:'bell' },
      { k:'punya',     label:'Punya rules',   icon:'lotus' },
      { k:'audit',     label:'Audit log',     icon:'file' },
    ],
    sanchalak: [
      { k:'dashboard', label:'Dashboard',     icon:'grid' },
      { k:'students',  label:'My students',   icon:'users', badge:84 },
      { k:'attendance',label:'Attendance',    icon:'home' },
      { k:'notices',   label:'Notices',       icon:'bell' },
      { k:'punya',     label:'Award Punya',   icon:'lotus' },
    ],
    super: [
      { k:'dashboard', label:'Dashboard',     icon:'grid' },
      { k:'cities',    label:'Cities',        icon:'home', badge:8 },
      { k:'students',  label:'All students',  icon:'users', badge:'14.2k' },
      { k:'notices',   label:'Broadcasts',    icon:'bell' },
      { k:'punya',     label:'Punya rules',   icon:'lotus' },
      { k:'billing',   label:'Billing',       icon:'file' },
      { k:'audit',     label:'Audit log',     icon:'file' },
    ],
  };
  const items = itemsByRole[role];
  const roleMeta = {
    cityAdmin: { name:'Rajesh Mehta', sub:'Pune · City Admin', initials:'RM' },
    sanchalak: { name:'Suresh S.',    sub:'Mahavir · Sanchalak', initials:'SS' },
    super:     { name:'Anjali T.',    sub:'Trust HQ · Super',  initials:'AT' },
  }[role];
  return (
    <aside style={{
      width: 240, background: JP.maroon, color: JP.cream, height:'100%',
      display:'flex', flexDirection:'column', padding:'18px 12px',
      borderRight:`1px solid ${JP.maroon700}`,
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'0 6px 14px', borderBottom:'1px solid rgba(253,248,242,.12)' }}>
        <div style={{ width:34, height:34, borderRadius:8, background:`linear-gradient(135deg, ${JP.saffron300}, ${JP.saffron})`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:JP.display, fontSize:24, color:'#FFFFFF' }}>ज</div>
        <div>
          <div style={{ fontFamily:JP.display, fontSize:16, lineHeight:1 }}>Jain Pathshala</div>
          <div style={{ fontSize:10, color:JP.saffron300, marginTop:2, letterSpacing:'.12em', textTransform:'uppercase' }}>{roleMeta.sub.split(' · ')[1]}</div>
        </div>
      </div>
      <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:2, flex:1 }}>
        {items.map(it => {
          const on = it.k === active;
          return (
            <button key={it.k} onClick={() => onChange(it.k)} style={{
              appearance:'none', border:0, cursor:'pointer', textAlign:'left',
              display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
              background: on ? 'rgba(212,98,26,.22)' : 'transparent',
              color: on ? '#FFFFFF' : 'rgba(253,248,242,.78)',
              fontSize:13, fontWeight: on ? 600 : 500, borderRadius:8, fontFamily:JP.body,
            }}>
              <AdminIcon name={it.icon} size={16} color={on ? '#FFFFFF' : 'rgba(253,248,242,.78)'}/>
              <span style={{ flex:1 }}>{it.label}</span>
              {it.badge !== undefined && <span style={{ background:on ? JP.saffron : 'rgba(253,248,242,.12)', color:'#FFFFFF', fontSize:10, padding:'1px 7px', borderRadius:999 }}>{it.badge}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid rgba(253,248,242,.12)', display:'flex', alignItems:'center', gap:10 }}>
        <Avatar initials={roleMeta.initials} size={32} gradient={false}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:600, lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{roleMeta.name}</div>
          <div style={{ fontSize:10, color:JP.saffron300 }}>{roleMeta.sub}</div>
        </div>
        <AdminIcon name="settings" size={14} color="rgba(253,248,242,.6)"/>
      </div>
    </aside>
  );
}

function Topbar({ title, role, onRole, children }) {
  return (
    <header style={{
      display:'flex', alignItems:'center', gap:12, padding:'14px 24px',
      background:'linear-gradient(180deg, #FDF8F2 0%, #FFFFFF 100%)',
      borderBottom:`1px solid ${JP.creamDeeper}`,
    }}>
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:24, lineHeight:1.1 }}>{title}</div>
      </div>
      {/* Search */}
      <div style={{ display:'flex', alignItems:'center', gap:6, background:'#FFFFFF', border:`1px solid ${JP.border}`, padding:'7px 12px', borderRadius:10, minWidth:240 }}>
        <AdminIcon name="search" size={16} color={JP.textSub}/>
        <span style={{ fontSize:13, color:JP.textDim }}>Search students, notices…</span>
        <span style={{ marginLeft:'auto', fontFamily:JP.mono, fontSize:10, color:JP.textSub, padding:'1px 5px', border:`1px solid ${JP.creamDeeper}`, borderRadius:4 }}>⌘K</span>
      </div>
      {/* Role switcher (demo only) */}
      <div style={{ display:'flex', background:JP.creamDark, padding:3, borderRadius:10 }}>
        {[['cityAdmin','City'],['sanchalak','Sanchalak'],['super','Super']].map(([k,l]) => (
          <button key={k} onClick={() => onRole(k)} style={{
            appearance:'none', border:0, cursor:'pointer',
            padding:'5px 10px', borderRadius:7, fontSize:11, fontWeight:600, fontFamily:JP.body,
            background: role===k ? '#FFFFFF' : 'transparent',
            color: role===k ? JP.maroon : JP.textSub,
            boxShadow: role===k ? JP.sh1 : 'none',
          }}>{l}</button>
        ))}
      </div>
      {children}
    </header>
  );
}

// ───────────────── Stats card ─────────────────
function StatsCard({ label, value, delta, deltaDir = 'up', sub, accent }) {
  const upGood = deltaDir === 'up';
  const deltaColor = upGood ? JP.success : JP.error;
  const deltaBg = upGood ? JP.successBg : JP.errorBg;
  return (
    <div style={{
      background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:12,
      padding:18, boxShadow: JP.sh1, position:'relative', overflow:'hidden',
    }}>
      <div style={{ fontSize:11, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', color:JP.textSub }}>{label}</div>
      <div style={{ fontFamily:JP.display, fontSize:36, lineHeight:'42px', color: accent || JP.textPrimary, marginTop:4 }}>{value}</div>
      {(delta || sub) && (
        <div style={{ marginTop:8, display:'flex', alignItems:'center', gap:8 }}>
          {delta && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 8px', background:deltaBg, color:deltaColor, borderRadius:999, fontSize:11, fontWeight:600 }}>
              <AdminIcon name={upGood ? 'arrowUp' : 'arrowDn'} size={10} color={deltaColor}/> {delta}
            </span>
          )}
          {sub && <span style={{ fontSize:11, color:JP.textSub }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

// ───────────────── Status / pills ─────────────────
function StatusBadge({ status }) {
  const map = {
    Pending:    { bg: JP.warningBg, fg: JP.warning },
    Approved:   { bg: JP.successBg, fg: JP.success },
    Rejected:   { bg: JP.errorBg,   fg: JP.error },
    'In review':{ bg: JP.infoBg,    fg: JP.info },
    Resolved:   { bg: JP.creamDark, fg: JP.textSub },
    Active:     { bg: JP.saffron50, fg: JP.saffron },
    Inactive:   { bg: JP.creamDark, fg: JP.textDim },
  };
  const m = map[status] || map.Active;
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:999,
    background:m.bg, color:m.fg, fontSize:11, fontWeight:600,
  }}>
    <span style={{ width:5, height:5, borderRadius:'50%', background:m.fg }}/>
    {status}
  </span>;
}

function AgePill({ group }) {
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:5, padding:'2px 8px', borderRadius:999,
    background:JP.ageBg[group], color:JP.age[group], fontSize:11, fontWeight:600,
  }}>{group}</span>;
}
function TierBadge({ tier }) {
  const c = JP.tier[tier];
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:5, padding:'2px 8px', borderRadius:999,
    background:`${c}14`, color:c, fontFamily:JP.display, fontSize:12,
  }}>
    <span style={{ width:5, height:5, borderRadius:'50%', background:c }}/>
    {tier}
  </span>;
}

// ───────────────── Form fields ─────────────────
function FieldLabel({ children, required, hint }) {
  return <label style={{ display:'block', fontSize:11, fontWeight:600, color:JP.textSub, letterSpacing:'.06em', textTransform:'uppercase', marginBottom:6 }}>{children}{required && <span style={{ color:JP.saffron, marginLeft:4 }}>*</span>}{hint && <span style={{ fontWeight:400, textTransform:'none', letterSpacing:'normal', marginLeft:6, color:JP.textDim }}>{hint}</span>}</label>;
}
function TextField({ label, value, placeholder, error, ...rest }) {
  const [focus, setFocus] = useState(false);
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input value={value || ''} placeholder={placeholder}
        onFocus={()=>setFocus(true)} onBlur={()=>setFocus(false)}
        {...rest}
        style={{
          width:'100%', boxSizing:'border-box', padding:'10px 12px', borderRadius:10,
          border: error ? `1.5px solid ${JP.error}` : (focus ? `2px solid ${JP.saffron}` : `1.5px solid ${JP.border}`),
          boxShadow: focus && !error ? '0 0 0 3px rgba(212,98,26,.28)' : (error ? `0 0 0 3px ${JP.errorBg}` : 'none'),
          fontFamily:JP.body, fontSize:14, color:JP.textPrimary, background: error ? JP.errorBg : '#FFFFFF', outline:'none',
        }}/>
      {error && <div style={{ marginTop:4, fontSize:11, color:JP.error }}>{error}</div>}
    </div>
  );
}
function SelectField({ label, value, options = [] }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{
        display:'flex', alignItems:'center', padding:'10px 12px', borderRadius:10,
        border:`1.5px solid ${JP.border}`, background:'#FFFFFF', fontSize:14, color:JP.textPrimary, cursor:'pointer',
      }}>
        <span style={{ flex:1 }}>{value || options[0]}</span>
        <AdminIcon name="chevron" size={14} color={JP.textSub}/>
      </div>
    </div>
  );
}
function DateField({ label, value }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{
        display:'flex', alignItems:'center', padding:'10px 12px', borderRadius:10,
        border:`1.5px solid ${JP.border}`, background:'#FFFFFF', fontSize:14, color:JP.textPrimary,
      }}>
        <span style={{ flex:1, fontFamily:JP.mono }}>{value}</span>
        <AdminIcon name="calendar" size={14} color={JP.textSub}/>
      </div>
    </div>
  );
}
function FileField({ label, hint }) {
  return (
    <div>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <div style={{
        padding:'18px', border:`1.5px dashed ${JP.textDim}`, borderRadius:10, textAlign:'center',
        color:JP.textSub, fontSize:13, background:JP.cream,
      }}>
        <AdminIcon name="upload" size={18} color={JP.textSub}/> <span style={{ verticalAlign:'middle', marginLeft:6 }}>Drag a JPG/PNG here, or <span style={{ color:JP.saffron, fontWeight:600 }}>browse</span></span>
      </div>
    </div>
  );
}

Object.assign(window, {
  AdminIcon, Avatar, Sidebar, Topbar, StatsCard, StatusBadge, AgePill, TierBadge,
  FieldLabel, TextField, SelectField, DateField, FileField,
});
