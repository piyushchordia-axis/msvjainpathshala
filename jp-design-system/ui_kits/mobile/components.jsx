// Shared atomic components for the Jain Pathshala mobile kit.
// Exposes Icon, PrimaryButton, SecondaryButton, GhostButton, Avatar,
// AgePill, AttendanceChip, TierBadge, PunyaBadge, Card, Header, TabBar, EmptyState.

const { useState } = React;

// ───────────────── Icons (Lucide-style, 24/1.75) ─────────────────
function Icon({ name, size = 22, color = 'currentColor', fill = 'none' }) {
  const P = {
    strokeWidth: 1.85, strokeLinecap: 'round', strokeLinejoin: 'round',
    stroke: fill === 'none' ? color : 'none', fill: fill === 'none' ? 'none' : color,
  };
  const paths = {
    home:        <path d="M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V11Z"/>,
    check:       <path d="M9 11l3 3 4-4M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2Z"/>,
    bell:        <g><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></g>,
    user:        <g><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></g>,
    lotus:       <path d="M12 2 9 9H2l5.5 4-2 7L12 16l6.5 4-2-7L22 9h-7Z"/>,
    chevron:     <path d="m6 9 6 6 6-6"/>,
    back:        <path d="m15 6-6 6 6 6"/>,
    plus:        <path d="M12 5v14M5 12h14"/>,
    close:       <path d="M18 6 6 18M6 6l12 12"/>,
    checkOnly:   <path d="M20 6 9 17l-5-5"/>,
    pin:         <path d="m12 17 5-5h-3V3h-4v9H7l5 5Zm-7 4h14v-2H5v2Z"/>,
    clock:       <g><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>,
    mapPin:      <g><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 7 8 12 8 12s8-5 8-12a8 8 0 0 0-8-8Z"/></g>,
    book:        <g><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></g>,
    trophy:      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21 1.18.54 2.03 2.03 2.03 3.79M18 2H6v7a6 6 0 0 0 12 0V2Z"/>,
    settings:    <g><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.3 7.2l-.1-.1A2 2 0 1 1 7 4.3l.1.1A1.7 1.7 0 0 0 9 4.7 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></g>,
    flame:       <path d="M12 2c2 4 6 6 6 12a6 6 0 1 1-12 0c0-3 2-4 2-7 2 2 4 2 4-5Z"/>,
    search:      <g><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></g>,
    sparkles:    <g><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/><path d="m6 6 2 2M16 16l2 2M16 8l2-2M6 18l2-2"/></g>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...P}>{paths[name] || null}</svg>
  );
}

// ───────────────── Buttons ─────────────────
function PrimaryButton({ children, leftIcon, loading, disabled, onClick, style }) {
  const [p, setP] = useState(false);
  return (
    <button onClick={!disabled && !loading ? onClick : undefined}
      onPointerDown={() => setP(true)} onPointerUp={() => setP(false)} onPointerLeave={() => setP(false)}
      disabled={disabled} style={{
        appearance: 'none', border: 0, cursor: disabled ? 'default' : 'pointer',
        height: 50, padding: '0 18px', borderRadius: 12, fontFamily: JP.body,
        fontSize: 15, fontWeight: 600,
        background: disabled ? '#EFE6D5' : (p ? JP.saffron700 : JP.saffron),
        color: disabled ? JP.textDim : '#FFFFFF',
        boxShadow: disabled ? 'none' : JP.sh2,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transform: p ? 'scale(0.98)' : 'scale(1)',
        transition: 'transform 140ms cubic-bezier(.2,.8,.2,1), background 140ms', ...style,
      }}>
      {loading ? <span style={{ width:16, height:16, border:'2px solid rgba(255,255,255,.4)', borderTopColor:'#FFF', borderRadius:'50%', animation:'jpSpin 1s linear infinite' }}/> : leftIcon}
      {children}
    </button>
  );
}
function SecondaryButton({ children, onClick, style }) {
  const [p,setP] = useState(false);
  return <button onClick={onClick}
    onPointerDown={()=>setP(true)} onPointerUp={()=>setP(false)} onPointerLeave={()=>setP(false)}
    style={{
      appearance:'none', cursor:'pointer', height:48, padding:'0 18px', borderRadius:12,
      fontFamily:JP.body, fontSize:15, fontWeight:600,
      background: p ? JP.maroon50 : 'transparent',
      color: p ? JP.maroon700 : JP.maroon,
      border:`1.5px solid ${p ? JP.maroon700 : JP.maroon}`,
      display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8,
      transition:'all 140ms cubic-bezier(.2,.8,.2,1)', ...style,
    }}>{children}</button>;
}
function GhostButton({ children, onClick, style }) {
  return <button onClick={onClick} style={{
    appearance:'none', border:0, background:'transparent', color:JP.saffron,
    cursor:'pointer', height:44, padding:'0 14px', borderRadius:12,
    fontFamily:JP.body, fontSize:15, fontWeight:600, ...style,
  }}>{children}</button>;
}

// ───────────────── Avatar ─────────────────
function Avatar({ initials = 'A', size = 40, msv = false, gradient = true }) {
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <div style={{
        width:size, height:size, borderRadius:'50%',
        background: gradient ? `linear-gradient(135deg, ${JP.saffron300}, ${JP.saffron})` : JP.creamDark,
        color: gradient ? '#FFFFFF' : JP.maroon,
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:JP.body, fontWeight:700, fontSize: size * 0.38,
        border: msv ? `3px solid ${JP.gold50}` : 'none',
        boxSizing:'border-box',
      }}>{initials}</div>
      {msv && (
        <div style={{
          position:'absolute', right:-2, bottom:-2, padding:'2px 5px', borderRadius:6,
          background:`linear-gradient(135deg, ${JP.gold300}, ${JP.gold})`,
          color:'#FFFFFF', fontSize: Math.max(8, size*0.16), fontWeight:800, letterSpacing:'.04em',
          boxShadow:'0 1px 3px rgba(122,24,24,.18)',
        }}>MSV</div>
      )}
    </div>
  );
}

// ───────────────── Pills & chips ─────────────────
function AgePill({ group }) {
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:6, padding:'3px 9px', borderRadius:999,
    background: JP.ageBg[group], color: JP.age[group],
    fontSize:11, fontWeight:600, lineHeight:1.2,
  }}>
    <span style={{ width:5, height:5, borderRadius:'50%', background: JP.age[group] }}/>
    {group}
  </span>;
}
function AttendanceChip({ status }) {
  const map = {
    Present: { bg: JP.successBg, fg: JP.success, icon: 'checkOnly' },
    Absent:  { bg: JP.errorBg,   fg: JP.error,   icon: 'close' },
    Late:    { bg: JP.warningBg, fg: JP.warning, icon: 'clock' },
    Leave:   { bg: JP.infoBg,    fg: JP.info,    icon: 'bell' },
  };
  const m = map[status];
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:999,
    background:m.bg, color:m.fg, fontSize:12, fontWeight:600,
  }}><Icon name={m.icon} size={12} color={m.fg}/> {status}</span>;
}
function PunyaBadge({ value, size = 'md' }) {
  const big = size === 'lg';
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:4,
    padding: big ? '6px 12px' : '3px 9px',
    borderRadius:999, background: JP.saffron50, color: JP.saffron,
    fontFamily: JP.body, fontWeight: 700, fontSize: big ? 14 : 12,
  }}>
    <Icon name="lotus" size={big ? 14 : 12} color={JP.saffron} fill="solid"/>
    {value} {big ? 'Punya' : ''}
  </span>;
}
function TierBadge({ tier }) {
  const colors = { Jigyasu:JP.tier.Jigyasu, Shravak:JP.tier.Shravak, Sadhak:JP.tier.Sadhak, Shraman:JP.tier.Shraman, Tirthankar:JP.tier.Tirthankar };
  // Solid pale tints — readable on cream surfaces AND on the dark maroon hero.
  const tints = {
    Jigyasu:   '#F1EAE0',
    Shravak:   '#DCEEDD',
    Sadhak:    '#DDE3F4',
    Shraman:   '#F4E6E6',
    Tirthankar:'#FAF1DC',
  };
  const c = colors[tier];
  const isGold = tier === 'Tirthankar';
  return <span style={{
    display:'inline-flex', alignItems:'center', gap:6, padding:'4px 10px', borderRadius:999,
    background: isGold ? 'linear-gradient(180deg,#FAF1DC,#E6C26B)' : tints[tier],
    color: c,
    fontFamily: JP.display, fontSize: 13, fontWeight: 600,
    border: isGold ? `1px solid ${JP.gold}` : 'none',
  }}>
    <span style={{ width:6, height:6, borderRadius:'50%', background: c }}/>
    {tier}
  </span>;
}

// ───────────────── Card / Layout ─────────────────
function Card({ children, elevated, style, ...rest }) {
  return <div {...rest} style={{
    background:'#FFFFFF',
    border: elevated ? 'none' : `1px solid ${JP.border}`,
    borderRadius: elevated ? 16 : 12,
    padding: 14, boxShadow: elevated ? JP.sh3 : JP.sh1,
    ...style,
  }}>{children}</div>;
}

function Header({ title, subtitle, left, right }) {
  return (
    <div style={{
      padding:'10px 16px 12px', background:'linear-gradient(180deg, #FDF8F2 0%, #FFFFFF 100%)',
      borderBottom:`1px solid ${JP.creamDeeper}`, display:'flex', alignItems:'center', gap:12,
    }}>
      {left}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:20, lineHeight:'24px' }}>{title}</div>
        {subtitle && <div style={{ fontSize:11, color:JP.textSub, marginTop:2 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function TabBar({ active, onChange }) {
  const items = [
    { k:'home',     label:'Home',     icon:'home' },
    { k:'attend',   label:'Attend',   icon:'check' },
    { k:'punya',    label:'Punya',    icon:'lotus' },
    { k:'notices',  label:'Notices',  icon:'bell' },
    { k:'profile',  label:'Profile',  icon:'user' },
  ];
  return (
    <div style={{
      position:'absolute', left:0, right:0, bottom:0, paddingBottom: 24,
      background:'rgba(253,248,242,0.85)',
      backdropFilter:'blur(18px) saturate(180%)', WebkitBackdropFilter:'blur(18px) saturate(180%)',
      borderTop:`1px solid ${JP.creamDeeper}`,
      display:'flex', justifyContent:'space-around', alignItems:'center', height: 80,
    }}>
      {items.map(it => {
        const on = active === it.k;
        return (
          <button key={it.k} onClick={() => onChange(it.k)} style={{
            appearance:'none', border:0, background:'transparent', cursor:'pointer',
            display:'flex', flexDirection:'column', alignItems:'center', gap:2,
            color: on ? JP.saffron : JP.textSub, padding:'6px 8px',
          }}>
            <Icon name={it.icon} size={22} color={on ? JP.saffron : JP.textSub} fill={on && it.icon==='lotus' ? 'solid' : 'none'}/>
            <span style={{ fontSize:10, fontWeight: on ? 700 : 500 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChildSelector({ children, active, onChange }) {
  return (
    <div style={{ display:'flex', gap:6 }}>
      {children.map(c => {
        const on = c.id === active;
        return (
          <button key={c.id} onClick={() => onChange(c.id)} style={{
            appearance:'none', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6,
            padding:'4px 10px 4px 4px', borderRadius:999,
            background: on ? '#FFFFFF' : JP.cream,
            border: on ? `1.5px solid ${JP.saffron}` : `1px solid ${JP.border}`,
          }}>
            <Avatar initials={c.initials} size={22} gradient={on}/>
            <span style={{ fontWeight:600, fontSize:12, color: on ? JP.textPrimary : JP.textSub }}>{c.name}</span>
            {on && <Icon name="chevron" size={12} color={JP.saffron}/>}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ title, body }) {
  return (
    <div style={{ padding:'28px 16px', textAlign:'center' }}>
      <svg width="80" height="80" viewBox="0 0 64 64" fill="none" stroke={JP.saffron300} strokeWidth="1.6" style={{ display:'block', margin:'0 auto' }}>
        <ellipse cx="32" cy="40" rx="20" ry="6"/>
        <path d="M32 40c0-12-8-20-12-22 4 4 6 14 12 22Z"/>
        <path d="M32 40c0-12 8-20 12-22-4 4-6 14-12 22Z"/>
        <path d="M32 40c0-16-4-22-4-22 0 6 2 16 4 22Z"/>
        <path d="M32 40c0-16 4-22 4-22 0 6-2 16-4 22Z"/>
        <circle cx="32" cy="36" r="3" fill={JP.saffron} stroke="none"/>
      </svg>
      <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:18, marginTop:8 }}>{title}</div>
      <div style={{ fontSize:13, color:JP.textSub, marginTop:4, lineHeight:'18px' }}>{body}</div>
    </div>
  );
}

Object.assign(window, {
  Icon, PrimaryButton, SecondaryButton, GhostButton,
  Avatar, AgePill, AttendanceChip, PunyaBadge, TierBadge,
  Card, Header, TabBar, ChildSelector, EmptyState,
});
