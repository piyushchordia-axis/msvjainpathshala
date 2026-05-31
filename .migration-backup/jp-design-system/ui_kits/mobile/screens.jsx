// All in-app screens for the Jain Pathshala mobile prototype.
// Screens: LoginScreen, OtpScreen, HomeScreen, AttendanceScreen,
//          PunyaScreen, NoticesScreen, NoticeDetail, ProfileScreen.
// Each takes (ctx, goto) — ctx is shared app state, goto switches screens.

const { useState, useEffect } = React;

// ===== Login =====
function LoginScreen({ goto }) {
  const [phone, setPhone] = useState('98765 43210');
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background: JP.cream }}>
      <div style={{ flex:1, padding:'32px 24px 0', textAlign:'center', position:'relative' }}>
        <div style={{ position:'absolute', inset:0, opacity:0.05, color:JP.saffron, pointerEvents:'none', overflow:'hidden' }}>
          <img src="../../assets/motif-mandala.svg" style={{ position:'absolute', right:-60, top:-40, width:280 }} alt=""/>
        </div>
        <div style={{ width:80, height:80, margin:'40px auto 0', borderRadius:18, background:`linear-gradient(135deg, ${JP.saffron300}, ${JP.saffron})`, display:'flex', alignItems:'center', justifyContent:'center', color:'#FFFFFF', fontFamily:JP.display, fontSize:54, boxShadow: JP.sh3 }}>ज</div>
        <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:30, lineHeight:'36px', marginTop:20 }}>Jain Pathshala</div>
        <div style={{ fontSize:13, color:JP.textSub, marginTop:6, letterSpacing:'.12em', textTransform:'uppercase', fontWeight:600 }}>Welcome back</div>

        <div style={{ marginTop:36, textAlign:'left' }}>
          <label style={{ fontSize:12, fontWeight:600, color:JP.textSub, letterSpacing:'.08em', textTransform:'uppercase' }}>Phone number</label>
          <div style={{ marginTop:8, display:'flex', alignItems:'center', background:'#FFFFFF', border:`1.5px solid ${JP.border}`, borderRadius:12, padding:'4px 14px', boxShadow: JP.sh1 }}>
            <span style={{ fontFamily:JP.mono, color:JP.textPrimary, fontWeight:600 }}>+91</span>
            <span style={{ width:1, height:24, background: JP.creamDeeper, margin:'0 12px' }}/>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="98xxxxxxxx" style={{
              flex:1, border:0, outline:0, background:'transparent', padding:'12px 0', fontFamily:JP.mono,
              fontSize:16, color:JP.textPrimary, letterSpacing:'.04em',
            }}/>
          </div>
          <div style={{ fontSize:12, color:JP.textSub, marginTop:8 }}>We'll send a 4-digit OTP by SMS.</div>
        </div>
      </div>
      <div style={{ padding:'12px 24px 40px' }}>
        <PrimaryButton onClick={() => goto('otp')} style={{ width:'100%' }}>Send OTP</PrimaryButton>
        <div style={{ textAlign:'center', marginTop:12, fontSize:12, color:JP.textSub }}>
          Need help? <span style={{ color:JP.saffron, fontWeight:600 }}>Contact your Sanchalak</span>
        </div>
      </div>
    </div>
  );
}

// ===== OTP =====
function OtpScreen({ goto }) {
  const [digits, setDigits] = useState(['4','8','','']);
  const filled = digits.filter(Boolean).length;
  useEffect(() => {
    if (filled < 4) {
      const t = setTimeout(() => {
        setDigits(d => { const next=[...d]; const i = d.findIndex(x => !x); if(i>=0) next[i] = String(Math.floor(Math.random()*10)); return next; });
      }, 700);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => goto('home'), 600);
      return () => clearTimeout(t);
    }
  }, [filled]);
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', background: JP.cream }}>
      <div style={{ padding:'16px 16px 0' }}>
        <button onClick={() => goto('login')} style={{ appearance:'none', border:0, background:'transparent', cursor:'pointer', color:JP.maroon, display:'inline-flex', alignItems:'center', gap:4 }}>
          <Icon name="back" size={20} color={JP.maroon}/> <span style={{ fontWeight:600 }}>Back</span>
        </button>
      </div>
      <div style={{ flex:1, padding:'24px 24px 0' }}>
        <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:26, lineHeight:'32px' }}>Enter the OTP</div>
        <div style={{ fontSize:13, color:JP.textSub, marginTop:6 }}>Sent to +91 98xxxxxx10.</div>
        <div style={{ display:'flex', gap:12, marginTop:28 }}>
          {digits.map((d, i) => (
            <div key={i} style={{
              width:64, height:72, borderRadius:12, background:'#FFFFFF',
              border: i===filled ? `2px solid ${JP.saffron}` : `1.5px solid ${JP.border}`,
              boxShadow: i===filled ? '0 0 0 3px rgba(212,98,26,.28)' : JP.sh1,
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:JP.mono, fontSize:32, fontWeight:600, color: JP.textPrimary,
            }}>{d || (i===filled ? <span style={{ width:2, height:30, background:JP.textPrimary, animation:'jpBlink 1s steps(2) infinite' }}/> : '·')}</div>
          ))}
        </div>
        <div style={{ marginTop:20, fontSize:13, color: filled===4 ? JP.success : JP.textSub }}>
          {filled===4 ? '✓ Verifying — taking you home…' : `Auto-detecting OTP… (${filled}/4)`}
        </div>
        <div style={{ marginTop:18, fontSize:13, color:JP.textSub }}>
          Didn't get it? <span style={{ color:JP.saffron, fontWeight:600 }}>Resend in 0:24</span>
        </div>
      </div>
    </div>
  );
}

// ===== Home (Parent) =====
function HomeScreen({ ctx, goto }) {
  const child = ctx.children.find(c => c.id === ctx.activeChild);
  return (
    <>
      <div style={{
        padding:'10px 16px 14px', background:'linear-gradient(180deg, #FDF8F2 0%, #FFFFFF 100%)',
        borderBottom:`1px solid ${JP.creamDeeper}`,
      }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:JP.textSub, letterSpacing:'.12em', textTransform:'uppercase' }}>Namaste</div>
            <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:22, lineHeight:1.1, marginTop:2 }}>Rajesh Mehta</div>
          </div>
          <button onClick={()=>goto('profile')} style={{ appearance:'none', border:0, background:'transparent', cursor:'pointer' }}>
            <Avatar initials="RM" size={36} gradient={false}/>
          </button>
        </div>
        <div style={{ marginTop:10 }}>
          <ChildSelector children={ctx.children} active={ctx.activeChild} onChange={ctx.setActiveChild}/>
        </div>
      </div>
      <div style={{ padding:'14px 16px 100px', background: JP.cream }}>
        {/* Punya summary */}
        <Card elevated style={{ padding:16, marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:JP.textSub }}>Spiritual Tier</div>
              <div style={{ fontFamily:JP.display, color:JP.tier[child.tier], fontSize:24, lineHeight:'30px', marginTop:2 }}>{child.tier}</div>
            </div>
            <PunyaBadge value={`${child.punya}`} size="lg"/>
          </div>
          <div style={{ marginTop:14, display:'flex', justifyContent:'space-between', fontSize:11, color:JP.textSub }}>
            <span>{child.tier} · {child.tierStart}</span>
            <span>{child.nextTier} · {child.tierEnd}</span>
          </div>
          <div style={{ height:10, background:JP.creamDark, borderRadius:999, marginTop:6, overflow:'hidden' }}>
            <div style={{ width: `${child.tierPct}%`, height:'100%', background:`linear-gradient(90deg, ${JP.tier[child.tier]}, ${JP.tier[child.tier]}aa)`, borderRadius:999 }}/>
          </div>
          <div style={{ marginTop:8, fontSize:13, color: JP.textPrimary }}>
            <b>{child.tierEnd - child.punya} Punya</b> to <span style={{ fontFamily:JP.display, color:JP.tier[child.nextTier] }}>{child.nextTier}</span>
          </div>
        </Card>

        {/* Quick action: Mark attendance */}
        <Card style={{ marginBottom:14, padding:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:44, height:44, borderRadius:12, background: JP.saffron50, color: JP.saffron, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Icon name="mapPin" size={22} color={JP.saffron}/>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, color:JP.textPrimary, fontSize:14 }}>Saturday class · 5 PM</div>
              <div style={{ fontSize:12, color:JP.textSub }}>Mahavir Centre · 80 m away</div>
            </div>
            <PrimaryButton onClick={()=>goto('attend')} style={{ height:38, fontSize:13, padding:'0 14px' }}>Check in</PrimaryButton>
          </div>
        </Card>

        {/* Today's homework */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', margin:'4px 4px 8px' }}>
          <div style={{ fontFamily:JP.body, fontWeight:600, color:JP.textPrimary, fontSize:15 }}>This week's Niyam</div>
          <span style={{ fontSize:12, color:JP.saffron, fontWeight:600 }}>See all →</span>
        </div>
        <Card style={{ marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, color:JP.textSub, letterSpacing:'.12em', textTransform:'uppercase' }}>Niyam · Day 7</div>
              <div style={{ fontWeight:600, color:JP.textPrimary, fontSize:15, marginTop:2 }}>Write 5 lines on Ahimsa</div>
            </div>
            <PunyaBadge value="+10"/>
          </div>
          <div style={{ marginTop:10, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, color:JP.warning }}><Icon name="clock" size={12} color={JP.warning}/> Due tomorrow, 6 PM</span>
            <span style={{ padding:'3px 9px', background:JP.warningBg, color:JP.warning, borderRadius:999, fontSize:11, fontWeight:600 }}>In progress</span>
          </div>
        </Card>

        {/* Pinned notice */}
        <Card elevated style={{ padding:14, borderTop:`3px solid ${JP.saffron}` }}>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <div style={{ width:24, height:24, borderRadius:6, background:JP.saffron50, color:JP.saffron, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Icon name="pin" size={12} color={JP.saffron} fill="solid"/>
              </div>
              <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:16 }}>Paryushan Shivir starts 4 Sep</div>
            </div>
            <span style={{ fontSize:10, fontWeight:700, color:JP.saffron, letterSpacing:'.08em' }}>PINNED</span>
          </div>
          <div style={{ marginTop:6, fontSize:12, color:JP.textPrimary, lineHeight:1.4 }}>All Tarun &amp; Yuva students — tap to confirm attendance for the 8-day Shivir.</div>
          <button onClick={()=>goto('notice')} style={{ marginTop:8, appearance:'none', border:0, background:'transparent', color:JP.saffron, fontWeight:600, cursor:'pointer', padding:0, fontSize:13 }}>View notice →</button>
        </Card>
      </div>
    </>
  );
}

// ===== Attendance =====
function AttendanceScreen({ ctx, goto }) {
  const [state, setState] = useState('idle'); // idle | requesting | active
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state === 'active') {
      const i = setInterval(() => setElapsed(e => e + 1), 1000);
      return () => clearInterval(i);
    }
  }, [state]);
  const fmt = s => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  return (
    <>
      <Header title="Attendance" subtitle="Mahavir Centre · Tarun batch" left={
        <button onClick={()=>goto('home')} style={{ appearance:'none', border:0, background:'transparent', cursor:'pointer' }}>
          <Icon name="back" size={22} color={JP.maroon}/>
        </button>
      }/>
      <div style={{ padding:'14px 16px 100px', background: JP.cream }}>
        {/* Map area placeholder */}
        <div style={{ position:'relative', height:160, borderRadius:12, overflow:'hidden', border:`1px solid ${JP.border}`, background:`
          radial-gradient(circle at 30% 30%, ${JP.creamDark} 0%, ${JP.cream} 40%),
          repeating-linear-gradient(0deg, ${JP.creamDeeper}30 0 1px, transparent 1px 32px),
          repeating-linear-gradient(90deg, ${JP.creamDeeper}30 0 1px, transparent 1px 32px)
        `, marginBottom:14 }}>
          <div style={{ position:'absolute', left:'48%', top:'45%', width:14, height:14, borderRadius:'50%', background:JP.saffron, boxShadow:`0 0 0 8px ${JP.saffron}33`, animation:'jpPulse 1.4s infinite' }}/>
          <div style={{ position:'absolute', left:'30%', top:'62%', color: JP.maroon }}>
            <Icon name="mapPin" size={28} color={JP.maroon}/>
          </div>
          <div style={{ position:'absolute', left:8, bottom:8, padding:'4px 10px', background:'rgba(255,255,255,0.92)', borderRadius:8, fontSize:11, fontWeight:600, color:JP.textPrimary }}>
            80 m from centre · within range
          </div>
        </div>

        {state === 'idle' && (
          <Card elevated style={{ padding:16 }}>
            <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:20 }}>Mark yourself Present</div>
            <div style={{ fontSize:13, color:JP.textSub, marginTop:4 }}>Tap below to start a GPS-verified session. Punya +5 on completion.</div>
            <div style={{ display:'flex', gap:10, marginTop:14 }}>
              <SecondaryButton style={{ flex:1 }}>Mark Absent</SecondaryButton>
              <PrimaryButton leftIcon={<Icon name="checkOnly" size={18} color="#FFFFFF"/>} onClick={()=>{ setState('requesting'); setTimeout(()=>{ setState('active'); setElapsed(0); }, 900); }} style={{ flex:1 }}>
                Mark Present
              </PrimaryButton>
            </div>
          </Card>
        )}
        {state === 'requesting' && (
          <Card elevated style={{ padding:16, textAlign:'center' }}>
            <div style={{ width:48, height:48, margin:'4px auto 12px', borderRadius:'50%', border:`3px solid ${JP.saffron50}`, borderTopColor:JP.saffron, animation:'jpSpin 1s linear infinite' }}/>
            <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:18 }}>Confirming your location…</div>
            <div style={{ fontSize:12, color:JP.textSub, marginTop:4 }}>Please keep your phone awake.</div>
          </Card>
        )}
        {state === 'active' && (
          <Card elevated style={{ padding:16, borderLeft:`4px solid ${JP.success}` }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div>
                <div style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'3px 10px', background:JP.successBg, color:JP.success, borderRadius:999, fontSize:11, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase' }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:JP.success, animation:'jpPulse 1.4s infinite' }}/> Session active
                </div>
                <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:20, marginTop:8 }}>Mahavir Centre</div>
                <div style={{ fontSize:12, color:JP.textSub }}>Checked in at {new Date(Date.now() - elapsed*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontFamily:JP.mono, fontSize:26, fontWeight:600, color:JP.textPrimary }}>{fmt(elapsed)}</div>
                <div style={{ fontSize:10, color:JP.textSub, marginTop:2 }}>Live timer</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:10, marginTop:14 }}>
              <PrimaryButton onClick={()=>{ setState('idle'); goto('home'); }} style={{ flex:1 }}>Check Out</PrimaryButton>
              <button style={{ width:50, background:'#FFFFFF', border:`1.5px solid ${JP.border}`, borderRadius:12, color:JP.maroon, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                <Icon name="mapPin" size={22} color={JP.maroon}/>
              </button>
            </div>
          </Card>
        )}

        <div style={{ marginTop:18, fontFamily:JP.body, fontWeight:600, color:JP.textPrimary, fontSize:15, padding:'0 4px' }}>This month</div>
        <Card style={{ marginTop:8, padding:14 }}>
          <div style={{ display:'flex', justifyContent:'space-around', textAlign:'center' }}>
            <div><div style={{ fontFamily:JP.display, fontSize:24, color:JP.success }}>11</div><div style={{ fontSize:11, color:JP.textSub }}>Present</div></div>
            <div><div style={{ fontFamily:JP.display, fontSize:24, color:JP.warning }}>1</div><div style={{ fontSize:11, color:JP.textSub }}>Late</div></div>
            <div><div style={{ fontFamily:JP.display, fontSize:24, color:JP.error }}>0</div><div style={{ fontSize:11, color:JP.textSub }}>Absent</div></div>
            <div><div style={{ fontFamily:JP.display, fontSize:24, color:JP.textPrimary }}>92%</div><div style={{ fontSize:11, color:JP.textSub }}>Rate</div></div>
          </div>
        </Card>
      </div>
    </>
  );
}

// ===== Punya =====
function PunyaScreen({ ctx, goto }) {
  const child = ctx.children.find(c => c.id === ctx.activeChild);
  const rows = [
    { rank:1, name:'Aarav Mehta',  age:'Tarun', centre:'Mahavir',   pts:680, gold:true, you:child.id==='aarav' },
    { rank:2, name:'Diya Jain',    age:'Tarun', centre:'Mahavir',   pts:640, you:child.id==='diya' },
    { rank:3, name:'Vivaan Shah',  age:'Tarun', centre:'Parshvanath', pts:595 },
    { rank:4, name:'Mira Doshi',   age:'Tarun', centre:'Mahavir',   pts:540 },
    { rank:5, name:'Krish Sanghvi',age:'Tarun', centre:'Adinath',   pts:495 },
    { rank:6, name:'Ishaan Kothari',age:'Tarun', centre:'Mahavir',  pts:460 },
  ];
  return (
    <>
      <Header title="Punya Leaderboard" subtitle="Tarun group · This month" left={
        <button onClick={()=>goto('home')} style={{ appearance:'none', border:0, background:'transparent', cursor:'pointer' }}>
          <Icon name="back" size={22} color={JP.maroon}/>
        </button>
      }/>
      <div style={{ padding:'14px 16px 100px', background: JP.cream }}>
        <Card elevated style={{ padding:16, marginBottom:14, background:`linear-gradient(135deg, ${JP.maroon} 0%, ${JP.maroon700} 100%)`, color:'#FFFFFF', border:'none', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', right:-30, top:-30, opacity:0.12 }}>
            <img src="../../assets/motif-mandala.svg" width="200" height="200" style={{ filter:'invert(1) brightness(2)' }} alt=""/>
          </div>
          <div style={{ position:'relative' }}>
            <div style={{ fontSize:11, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:JP.saffron300 }}>You are</div>
            <div style={{ fontFamily:JP.display, fontSize:30, lineHeight:'34px', marginTop:4 }}>{child.tier}</div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:10 }}>
              <Icon name="lotus" size={22} color={JP.gold300} fill="solid"/>
              <div style={{ fontFamily:JP.mono, fontSize:30, fontWeight:600 }}>{child.punya}</div>
              <div style={{ fontSize:13, color: JP.saffron300, marginLeft:2 }}>Punya</div>
            </div>
            <div style={{ height:8, background:'rgba(255,255,255,0.15)', borderRadius:999, marginTop:14 }}>
              <div style={{ width:`${child.tierPct}%`, height:'100%', background:JP.gold300, borderRadius:999 }}/>
            </div>
            <div style={{ marginTop:6, fontSize:12, color: JP.saffron300 }}>
              {child.tierEnd - child.punya} to {child.nextTier} →
            </div>
          </div>
        </Card>

        <Card style={{ padding:0 }}>
          {rows.map((r,i) => (
            <div key={r.rank} style={{
              display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
              borderTop: i ? `1px solid ${JP.creamDeeper}` : 'none',
              background: r.gold ? 'linear-gradient(90deg, #FAF1DC 0%, #FFFFFF 60%)' : (r.you ? `${JP.saffron50}` : 'transparent'),
            }}>
              <div style={{ width:24, height:24, borderRadius:'50%', background: r.gold ? JP.gold : JP.creamDark, color: r.gold ? '#FFFFFF' : JP.maroon, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:11 }}>{r.rank}</div>
              <Avatar initials={r.name.split(' ').map(w=>w[0]).join('').slice(0,2)} size={32}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:13, color:JP.textPrimary, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.name} {r.you && <span style={{ fontSize:10, color:JP.saffron, fontWeight:700 }}>· YOU</span>}</div>
                <div style={{ fontSize:10, color:JP.textSub }}>{r.centre} Centre</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:4, color: r.gold ? JP.gold : JP.saffron, fontWeight:700, fontSize:14 }}>
                <Icon name="lotus" size={12} color={r.gold ? JP.gold : JP.saffron} fill="solid"/> {r.pts}
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

// ===== Notices list =====
function NoticesScreen({ goto }) {
  return (
    <>
      <Header title="Notices" subtitle="3 new this week"/>
      <div style={{ padding:'14px 16px 100px', background: JP.cream, display:'flex', flexDirection:'column', gap:10 }}>
        <Card elevated style={{ padding:14, borderTop:`3px solid ${JP.saffron}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:24, height:24, borderRadius:6, background:JP.saffron50, color:JP.saffron, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <Icon name="pin" size={12} color={JP.saffron} fill="solid"/>
              </div>
              <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:16 }}>Paryushan Shivir starts 4 Sep</div>
            </div>
            <span style={{ fontSize:10, fontWeight:700, color:JP.saffron, letterSpacing:'.08em' }}>PINNED</span>
          </div>
          <div style={{ marginTop:6, fontSize:13, color:JP.textPrimary, lineHeight:1.4 }}>All Tarun &amp; Yuva students — registration closes Sunday.</div>
          <button onClick={()=>goto('notice')} style={{ marginTop:8, appearance:'none', border:0, background:'transparent', color:JP.saffron, fontWeight:600, cursor:'pointer', padding:0, fontSize:13 }}>Open →</button>
        </Card>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <div style={{ fontWeight:600, color:JP.textPrimary, fontSize:14 }}>Holiday tomorrow — Mahavir Jayanti</div>
            <div style={{ fontSize:11, color:JP.textSub }}>Yesterday</div>
          </div>
          <div style={{ marginTop:4, fontSize:13, color:JP.textSub }}>No classes Friday. Resume Saturday at usual time.</div>
        </Card>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <div style={{ fontWeight:600, color:JP.textPrimary, fontSize:14 }}>New Niyam for this week</div>
            <div style={{ fontSize:11, color:JP.textSub }}>3 days ago</div>
          </div>
          <div style={{ marginTop:4, fontSize:13, color:JP.textSub }}>Daily reflection on Ahimsa. Submit by Sunday evening for Punya +10.</div>
        </Card>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <div style={{ fontWeight:600, color:JP.textPrimary, fontSize:14 }}>Inter-centre essay competition</div>
            <div style={{ fontSize:11, color:JP.textSub }}>1 wk ago</div>
          </div>
          <div style={{ marginTop:4, fontSize:13, color:JP.textSub }}>Topic: "Aparigraha in daily life." Open to Tarun and Yuva.</div>
        </Card>
      </div>
    </>
  );
}

function NoticeDetail({ goto }) {
  return (
    <>
      <Header title="Notice" left={
        <button onClick={()=>goto('notices')} style={{ appearance:'none', border:0, background:'transparent', cursor:'pointer' }}>
          <Icon name="back" size={22} color={JP.maroon}/>
        </button>
      } right={
        <button style={{ appearance:'none', border:0, background:'transparent', cursor:'pointer', color:JP.maroon, fontWeight:600 }}>Share</button>
      }/>
      <div style={{ padding:'18px 18px 100px', background: JP.cream }}>
        <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', background:JP.saffron50, color:JP.saffron, borderRadius:999, fontSize:11, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase' }}>
          <Icon name="pin" size={10} color={JP.saffron} fill="solid"/> Pinned
        </span>
        <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:26, lineHeight:'32px', marginTop:10 }}>Paryushan Shivir<br/>starts 4 September</div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:14, paddingBottom:14, borderBottom:`1px solid ${JP.creamDeeper}` }}>
          <Avatar initials="CA" size={28} gradient={false}/>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:JP.textPrimary }}>Rajesh Kothari · City Admin</div>
            <div style={{ fontSize:11, color:JP.textSub }}>Pune · 2 hours ago</div>
          </div>
        </div>
        <div style={{ marginTop:14, fontSize:15, lineHeight:'24px', color:JP.textPrimary }}>
          Dear parents and students,<br/><br/>
          The annual <b>8-day Paryushan Shivir</b> begins on <b>4 September</b>. All Tarun and Yuva students are encouraged to attend the full programme, which includes daily pravachan, Niyam practice, and community seva.<br/><br/>
          Please confirm attendance by Sunday using the button below. Punya +50 will be credited on completion of the full shivir.
        </div>
        <div style={{ display:'flex', gap:10, marginTop:20 }}>
          <SecondaryButton style={{ flex:1 }}>Maybe later</SecondaryButton>
          <PrimaryButton style={{ flex:1 }}>Confirm attendance</PrimaryButton>
        </div>
      </div>
    </>
  );
}

// ===== Profile =====
function ProfileScreen({ ctx, goto }) {
  const child = ctx.children.find(c => c.id === ctx.activeChild);
  return (
    <>
      <Header title="Profile" left={
        <button onClick={()=>goto('home')} style={{ appearance:'none', border:0, background:'transparent', cursor:'pointer' }}>
          <Icon name="back" size={22} color={JP.maroon}/>
        </button>
      }/>
      <div style={{ padding:'14px 16px 100px', background: JP.cream }}>
        {/* hero / id card preview */}
        <Card elevated style={{ padding:0, overflow:'hidden' }}>
          <div style={{ background:`linear-gradient(135deg, ${JP.maroon}, ${JP.maroon700})`, padding:'18px 16px', color:'#FFFFFF', position:'relative' }}>
            <div style={{ position:'absolute', right:-20, top:-20, opacity:.1 }}>
              <img src="../../assets/motif-mandala.svg" width="160" height="160" style={{ filter:'invert(1) brightness(2)' }} alt=""/>
            </div>
            <div style={{ display:'flex', gap:14, alignItems:'center', position:'relative' }}>
              <Avatar initials={child.initials} size={64} msv={child.msv}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontFamily:JP.display, fontSize:20, lineHeight:1.1 }}>{child.fullName}</div>
                <div style={{ fontSize:12, color:JP.saffron300, marginTop:2 }}>JP-PUN-{child.idNum}</div>
                <div style={{ display:'flex', gap:6, marginTop:8 }}>
                  <AgePill group={child.age}/>
                  <TierBadge tier={child.tier}/>
                </div>
              </div>
            </div>
          </div>
          <div style={{ padding:'12px 14px', display:'flex', justifyContent:'space-between' }}>
            <div>
              <div style={{ fontSize:11, color:JP.textSub }}>Father</div>
              <div style={{ fontWeight:600, fontSize:13 }}>{child.father}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:JP.textSub }}>Centre</div>
              <div style={{ fontWeight:600, fontSize:13 }}>{child.centre}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:JP.textSub }}>Batch</div>
              <div style={{ fontWeight:600, fontSize:13 }}>Sat 5–7 PM</div>
            </div>
          </div>
        </Card>

        <div style={{ marginTop:18, fontWeight:600, color:JP.textPrimary, fontSize:15 }}>Settings</div>
        <Card style={{ marginTop:8, padding:0 }}>
          {['Language · English','Notifications','Privacy & data','Help & support','Log out'].map((label, i, arr) => (
            <div key={label} style={{ padding:'14px 16px', borderTop: i ? `1px solid ${JP.creamDeeper}` : 'none', display:'flex', justifyContent:'space-between', alignItems:'center', color: i===arr.length-1 ? JP.error : JP.textPrimary, fontSize:14, fontWeight: i===arr.length-1 ? 600 : 400 }}>
              {label}
              {i < arr.length-1 && <Icon name="chevron" size={16} color={JP.textSub}/>}
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

Object.assign(window, {
  LoginScreen, OtpScreen, HomeScreen, AttendanceScreen, PunyaScreen, NoticesScreen, NoticeDetail, ProfileScreen,
});
