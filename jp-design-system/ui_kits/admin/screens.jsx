// Admin screens — Dashboard, Students, Notices, Audit.
const { useState } = React;

// ===== Dashboard =====
function DashboardScreen({ role }) {
  return (
    <div style={{ padding:'24px', background:JP.cream }}>
      {/* greeting */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:18 }}>
        <div>
          <div style={{ fontSize:13, color:JP.textSub, fontWeight:500 }}>Tuesday, 20 May 2026</div>
          <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:28, lineHeight:'34px', marginTop:2 }}>Good morning, Rajesh</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button style={{ appearance:'none', cursor:'pointer', padding:'9px 14px', background:'#FFFFFF', border:`1.5px solid ${JP.border}`, borderRadius:10, color:JP.maroon, fontFamily:JP.body, fontSize:13, fontWeight:600, display:'inline-flex', alignItems:'center', gap:6 }}>
            <AdminIcon name="download" size={14} color={JP.maroon}/> Export report
          </button>
          <button style={{ appearance:'none', cursor:'pointer', padding:'9px 14px', background:JP.saffron, border:0, borderRadius:10, color:'#FFFFFF', fontFamily:JP.body, fontSize:13, fontWeight:600, display:'inline-flex', alignItems:'center', gap:6, boxShadow: JP.sh2 }}>
            <AdminIcon name="plus" size={14} color="#FFFFFF"/> Post notice
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:14, marginBottom:18 }}>
        <StatsCard label="Active students" value="1,248" delta="+8.2%" sub="vs last month"/>
        <StatsCard label="Today's attendance" value={<span>89<span style={{ fontSize:20, color: JP.textSub }}>%</span></span>} delta="−2.1%" deltaDir="down" sub="vs avg"/>
        <StatsCard label="Punya awarded" value="14,820" sub="this week" accent={JP.saffron}/>
        <StatsCard label="Pending approvals" value="6" sub="2 overdue" accent={JP.warning}/>
      </div>

      {/* Two-column lower */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:14 }}>
        {/* Attendance chart */}
        <div style={{ background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:12, padding:18, boxShadow: JP.sh1 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
            <div>
              <div style={{ fontSize:11, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', color:JP.textSub }}>Attendance this week</div>
              <div style={{ fontFamily:JP.display, fontSize:22, color:JP.textPrimary, marginTop:2 }}>by centre</div>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {['Week','Month','Year'].map((p,i)=>(
                <span key={p} style={{ padding:'3px 10px', background: i===0?JP.saffron50:'transparent', color: i===0?JP.saffron:JP.textSub, borderRadius:6, fontSize:11, fontWeight:600 }}>{p}</span>
              ))}
            </div>
          </div>
          {/* Bar chart */}
          <div style={{ display:'flex', alignItems:'flex-end', gap:14, height:160, marginTop:18, paddingBottom:24, borderBottom:`1px solid ${JP.creamDeeper}` }}>
            {[
              { name:'Mahavir', v:92 }, { name:'Parshvanath', v:88 }, { name:'Adinath', v:76 },
              { name:'Shantinath', v:84 }, { name:'Neminath', v:90 }, { name:'Suparshva', v:71 },
              { name:'Chandraprabh', v:67 },
            ].map((d,i) => (
              <div key={d.name} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:6, position:'relative' }}>
                <div style={{ fontSize:11, fontWeight:600, color:JP.textPrimary, position:'absolute', top:-18 }}>{d.v}%</div>
                <div style={{ width:'100%', height:`${d.v}%`, background:`linear-gradient(180deg, ${JP.saffron} 0%, ${JP.saffron700} 100%)`, borderRadius:'8px 8px 4px 4px', boxShadow: JP.sh1 }}/>
                <div style={{ fontSize:10, color:JP.textSub, position:'absolute', bottom:-22 }}>{d.name}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Approvals panel */}
        <div style={{ background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:12, padding:0, boxShadow: JP.sh1, overflow:'hidden' }}>
          <div style={{ padding:'14px 18px', borderBottom:`1px solid ${JP.creamDeeper}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ fontSize:11, fontWeight:600, letterSpacing:'.1em', textTransform:'uppercase', color:JP.textSub }}>Awaiting approval</div>
            <span style={{ padding:'2px 8px', background:JP.warningBg, color:JP.warning, borderRadius:999, fontSize:10, fontWeight:700 }}>6</span>
          </div>
          {[
            { who:'Aarav M.', what:'Leave on 15 Aug', age:'Tarun', status:'Pending' },
            { who:'Diya J.',  what:'Photo upload',    age:'Kishor', status:'In review' },
            { who:'Vivaan S.',what:'Niyam submission', age:'Tarun', status:'Pending' },
            { who:'Mira D.',  what:'MSV nomination',  age:'Tarun', status:'In review' },
          ].map((r,i,arr) => (
            <div key={i} style={{ padding:'12px 18px', display:'flex', alignItems:'center', gap:10, borderTop: i ? `1px solid ${JP.creamDeeper}` : 'none' }}>
              <Avatar initials={r.who.split(' ').map(x=>x[0]).join('').slice(0,2)} size={28}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:JP.textPrimary }}>{r.who}</div>
                <div style={{ fontSize:11, color:JP.textSub }}>{r.what}</div>
              </div>
              <StatusBadge status={r.status}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== Students table =====
function StudentsScreen() {
  const [sort, setSort] = useState('name');
  const rows = [
    { id:'JP-PUN-0428', name:'Aarav Mehta',    centre:'Mahavir',     age:'Tarun',  punya:680, status:'Active',   msv:true },
    { id:'JP-PUN-0431', name:'Diya Jain',      centre:'Mahavir',     age:'Tarun',  punya:640, status:'Pending' },
    { id:'JP-PUN-0455', name:'Vivaan Shah',    centre:'Parshvanath', age:'Kishor', punya:320, status:'Active' },
    { id:'JP-PUN-0468', name:'Mira Doshi',     centre:'Mahavir',     age:'Tarun',  punya:540, status:'Active' },
    { id:'JP-PUN-0511', name:'Krish Sanghvi',  centre:'Adinath',     age:'Tarun',  punya:495, status:'Active' },
    { id:'JP-PUN-0523', name:'Ishaan Kothari', centre:'Mahavir',     age:'Kishor', punya:460, status:'Inactive' },
    { id:'JP-PUN-0531', name:'Saanvi Bafna',   centre:'Neminath',    age:'Bal',    punya:180, status:'Active' },
    { id:'JP-PUN-0547', name:'Riya Gandhi',    centre:'Shantinath',  age:'Yuva',   punya:880, status:'Active',   msv:true },
  ];
  return (
    <div style={{ padding:'24px', background:JP.cream }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:14 }}>
        <div>
          <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:24, lineHeight:'30px' }}>Students</div>
          <div style={{ fontSize:13, color:JP.textSub, marginTop:2 }}>1,248 across 14 centres · 6 pending approvals</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button style={{ appearance:'none', cursor:'pointer', padding:'8px 12px', background:'#FFFFFF', border:`1.5px solid ${JP.border}`, borderRadius:10, color:JP.textPrimary, fontSize:13, fontWeight:600, display:'inline-flex', alignItems:'center', gap:6 }}>
            <AdminIcon name="filter" size={14}/> Filter
          </button>
          <button style={{ appearance:'none', cursor:'pointer', padding:'8px 14px', background:JP.saffron, border:0, borderRadius:10, color:'#FFFFFF', fontSize:13, fontWeight:600, display:'inline-flex', alignItems:'center', gap:6, boxShadow:JP.sh2 }}>
            <AdminIcon name="plus" size={14} color="#FFFFFF"/> Add student
          </button>
        </div>
      </div>

      <div style={{ background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:12, overflow:'hidden', boxShadow: JP.sh1 }}>
        {/* Header */}
        <div style={{ display:'grid', gridTemplateColumns:'40px 1.5fr 1.2fr 1fr 1fr 0.8fr 1fr 40px', alignItems:'center', padding:'12px 18px', background:JP.creamDark, fontSize:11, fontWeight:700, color:JP.maroon, letterSpacing:'.06em', textTransform:'uppercase' }}>
          <div></div>
          <div style={{ display:'flex', alignItems:'center', gap:4, cursor:'pointer' }} onClick={()=>setSort('name')}>Name <AdminIcon name={sort==='name' ? 'chevronUp':'chevron'} size={11}/></div>
          <div>Student ID</div>
          <div>Centre</div>
          <div>Age group</div>
          <div>Punya</div>
          <div>Status</div>
          <div></div>
        </div>
        {rows.map((r, i) => (
          <div key={r.id} style={{ display:'grid', gridTemplateColumns:'40px 1.5fr 1.2fr 1fr 1fr 0.8fr 1fr 40px', alignItems:'center', padding:'10px 18px', borderTop:`1px solid ${JP.creamDeeper}`, fontSize:13, background: i%2 ? JP.cream+'40' : '#FFFFFF' }}>
            <Avatar initials={r.name.split(' ').map(w=>w[0]).join('').slice(0,2)} size={28}/>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontWeight:600, color:JP.textPrimary }}>{r.name}</span>
              {r.msv && <span style={{ padding:'1px 5px', background:JP.gold50, color:JP.gold, fontSize:9, fontWeight:800, borderRadius:4, letterSpacing:'.04em' }}>MSV</span>}
            </div>
            <div style={{ fontFamily:JP.mono, fontSize:12, color:JP.textSub }}>{r.id}</div>
            <div style={{ color:JP.textSub }}>{r.centre}</div>
            <div><AgePill group={r.age}/></div>
            <div style={{ display:'flex', alignItems:'center', gap:4, color:JP.saffron, fontWeight:700, fontFamily:JP.mono }}>
              <AdminIcon name="lotus" size={12} color={JP.saffron} fill="solid"/> {r.punya}
            </div>
            <div><StatusBadge status={r.status}/></div>
            <div style={{ textAlign:'right', color:JP.textSub, cursor:'pointer' }}><AdminIcon name="more" size={16} color={JP.textSub}/></div>
          </div>
        ))}
        {/* Footer pagination */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', borderTop:`1px solid ${JP.creamDeeper}`, fontSize:12, color:JP.textSub }}>
          <div>Showing 1–8 of 1,248</div>
          <div style={{ display:'flex', gap:6 }}>
            <span style={{ padding:'4px 10px', border:`1px solid ${JP.border}`, borderRadius:6 }}>‹</span>
            <span style={{ padding:'4px 10px', background:JP.saffron, color:'#FFFFFF', borderRadius:6, fontWeight:600 }}>1</span>
            <span style={{ padding:'4px 10px', border:`1px solid ${JP.border}`, borderRadius:6 }}>2</span>
            <span style={{ padding:'4px 10px', border:`1px solid ${JP.border}`, borderRadius:6 }}>3</span>
            <span style={{ padding:'4px 10px', color:JP.textDim }}>…</span>
            <span style={{ padding:'4px 10px', border:`1px solid ${JP.border}`, borderRadius:6 }}>156</span>
            <span style={{ padding:'4px 10px', border:`1px solid ${JP.border}`, borderRadius:6 }}>›</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Notice composer =====
function NoticesScreen() {
  return (
    <div style={{ padding:'24px', background:JP.cream, display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
      {/* Composer */}
      <div style={{ background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:12, padding:24, boxShadow: JP.sh1 }}>
        <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:22 }}>New notice</div>
        <div style={{ fontSize:12, color:JP.textSub, marginTop:2, marginBottom:18 }}>Published notices are sent to selected groups instantly.</div>
        <div style={{ display:'grid', gap:14 }}>
          <TextField label="Title" value="Paryushan Shivir starts 4 September"/>
          <div>
            <FieldLabel>Body</FieldLabel>
            <div style={{ background:'#FFFFFF', border:`1.5px solid ${JP.border}`, borderRadius:10, minHeight:120, padding:'12px 14px', fontSize:14, color:JP.textPrimary, lineHeight:'21px' }}>
              All Tarun &amp; Yuva students — registration closes Sunday. Tap to confirm attendance for the 8-day Shivir.
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <SelectField label="Audience" value="Tarun + Yuva (all centres)"/>
            <SelectField label="Channel" value="Push + In-app"/>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <DateField label="Publish at" value="2026-05-20 09:00 IST"/>
            <TextField label="Tag" value="shivir, paryushan"/>
          </div>
          <FileField label="Attachment" hint="optional · PDF or image"/>
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:JP.saffron50, borderRadius:10 }}>
            <input type="checkbox" defaultChecked style={{ accentColor: JP.saffron, width:16, height:16 }}/>
            <span style={{ fontSize:13, color:JP.textPrimary }}>Pin to top of feed for 7 days</span>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:8 }}>
            <button style={{ appearance:'none', cursor:'pointer', padding:'10px 18px', background:'transparent', border:`1.5px solid ${JP.maroon}`, color:JP.maroon, borderRadius:10, fontWeight:600, fontSize:14 }}>Save draft</button>
            <button style={{ appearance:'none', cursor:'pointer', padding:'10px 18px', background:JP.saffron, color:'#FFFFFF', border:0, borderRadius:10, fontWeight:600, fontSize:14, boxShadow:JP.sh2 }}>Publish</button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div>
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:JP.textSub, marginBottom:10 }}>Mobile preview</div>
        <div style={{ background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:16, padding:14, boxShadow: JP.sh2, borderTop:`3px solid ${JP.saffron}` }}>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <div style={{ width:24, height:24, borderRadius:6, background:JP.saffron50, color:JP.saffron, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700 }}>📌</div>
              <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:16 }}>Paryushan Shivir starts 4 September</div>
            </div>
            <span style={{ fontSize:10, fontWeight:700, color:JP.saffron, letterSpacing:'.08em' }}>PINNED</span>
          </div>
          <div style={{ marginTop:8, fontSize:13, color:JP.textPrimary, lineHeight:1.4 }}>All Tarun &amp; Yuva students — registration closes Sunday.</div>
          <div style={{ marginTop:10, fontSize:11, color:JP.textSub }}>City Admin · just now</div>
        </div>
        <div style={{ marginTop:18, fontSize:11, fontWeight:600, letterSpacing:'.12em', textTransform:'uppercase', color:JP.textSub, marginBottom:10 }}>Recent notices</div>
        <div style={{ background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:12, boxShadow: JP.sh1, overflow:'hidden' }}>
          {[
            { t:'Holiday tomorrow', meta:'Yesterday · 1,240 read', status:'Active' },
            { t:'New Niyam this week', meta:'3 days ago · 980 read', status:'Active' },
            { t:'Inter-centre essay', meta:'1 wk ago · 720 read', status:'Resolved' },
          ].map((n,i,a) => (
            <div key={n.t} style={{ padding:'12px 14px', borderTop: i ? `1px solid ${JP.creamDeeper}` : 'none', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:600, fontSize:13, color:JP.textPrimary }}>{n.t}</div>
                <div style={{ fontSize:11, color:JP.textSub, marginTop:2 }}>{n.meta}</div>
              </div>
              <StatusBadge status={n.status}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== Audit log =====
function AuditScreen() {
  const log = [
    { ts:'12 May · 09:14', who:'Rajesh M.', wh:'rajesh.m@jp.app', what:'approved leave for', target:'Aarav Mehta', detail:'on 15 Aug', tag:'Approved' },
    { ts:'12 May · 08:47', who:'Priya J. (Didi)', wh:'priya.j@jp.app', what:'awarded', target:'+25 Punya', detail:'for Niyam streak', tag:'Active' },
    { ts:'11 May · 21:02', who:'Suresh S. (Sanchalak)', wh:'suresh.s@jp.app', what:'published notice', target:'"Paryushan Shivir"', detail:'', tag:'In review' },
    { ts:'11 May · 17:33', who:'Rajesh M.', wh:'rajesh.m@jp.app', what:'updated batch for', target:'Tarun · Mahavir', detail:'time changed to 5 PM', tag:'Approved' },
    { ts:'10 May · 14:20', who:'Anjali T. (Super)', wh:'anjali.t@jp.app', what:'rejected MSV nomination for', target:'Vivaan Shah', detail:'reason: attendance below 80%', tag:'Rejected' },
    { ts:'10 May · 11:08', who:'Suresh S. (Sanchalak)', wh:'suresh.s@jp.app', what:'enrolled', target:'Saanvi Bafna', detail:'into Bal batch', tag:'Active' },
  ];
  return (
    <div style={{ padding:'24px', background:JP.cream }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:14 }}>
        <div>
          <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:24, lineHeight:'30px' }}>Audit log</div>
          <div style={{ fontSize:13, color:JP.textSub, marginTop:2 }}>Immutable record of admin and teacher actions</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button style={{ appearance:'none', cursor:'pointer', padding:'8px 12px', background:'#FFFFFF', border:`1.5px solid ${JP.border}`, borderRadius:10, color:JP.textPrimary, fontSize:13, fontWeight:600, display:'inline-flex', alignItems:'center', gap:6 }}>
            <AdminIcon name="filter" size={14}/> Filter
          </button>
          <button style={{ appearance:'none', cursor:'pointer', padding:'8px 12px', background:'#FFFFFF', border:`1.5px solid ${JP.border}`, borderRadius:10, color:JP.textPrimary, fontSize:13, fontWeight:600, display:'inline-flex', alignItems:'center', gap:6 }}>
            <AdminIcon name="download" size={14}/> Export CSV
          </button>
        </div>
      </div>
      <div style={{ background:'#FFFFFF', border:`1px solid ${JP.border}`, borderRadius:12, overflow:'hidden', boxShadow:JP.sh1 }}>
        {log.map((e, i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 18px', borderTop: i ? `1px solid ${JP.creamDeeper}` : 'none', fontSize:13 }}>
            <div style={{ fontFamily:JP.mono, fontSize:11, color:JP.textSub, width:130, flexShrink:0 }}>{e.ts}</div>
            <Avatar initials={e.who.split(' ').map(w=>w[0]).slice(0,2).join('')} size={26} gradient={false}/>
            <div style={{ flex:1, color:JP.textPrimary, minWidth:0 }}>
              <b>{e.who}</b> {e.what} <b>{e.target}</b> <span style={{ color:JP.textSub }}>{e.detail}</span>
            </div>
            <StatusBadge status={e.tag}/>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DashboardScreen, StudentsScreen, NoticesScreen, AuditScreen });
