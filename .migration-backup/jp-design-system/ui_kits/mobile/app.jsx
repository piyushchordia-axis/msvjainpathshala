// App entry: orchestrates screen routing and shared state.
const { useState, useMemo } = React;

const childData = [
  { id:'aarav', initials:'AR', name:'Aarav', fullName:'Aarav Rajesh Mehta', father:'Rajesh Mehta', centre:'Mahavir',
    idNum:'0428', age:'Tarun', tier:'Sadhak', nextTier:'Shraman', punya:420, tierStart:300, tierEnd:700,
    get tierPct(){ return Math.round((this.punya-this.tierStart)/(this.tierEnd-this.tierStart)*100); }, msv:true },
  { id:'diya',  initials:'DM', name:'Diya',  fullName:'Diya Rajesh Mehta',  father:'Rajesh Mehta', centre:'Mahavir',
    idNum:'0431', age:'Kishor', tier:'Shravak', nextTier:'Sadhak', punya:185, tierStart:100, tierEnd:300,
    get tierPct(){ return Math.round((this.punya-this.tierStart)/(this.tierEnd-this.tierStart)*100); }, msv:false },
];

function App() {
  const [screen, setScreen] = useState('login');
  const [activeChild, setActiveChild] = useState('aarav');
  React.useEffect(() => { window.__setScreen = setScreen; }, []);

  const ctx = useMemo(() => ({
    children: childData.map(c => ({ ...c, tierPct: Math.round((c.punya - c.tierStart) / (c.tierEnd - c.tierStart) * 100) })),
    activeChild, setActiveChild,
  }), [activeChild]);

  let content;
  if (screen === 'login')   content = <LoginScreen   goto={setScreen}/>;
  else if (screen === 'otp')      content = <OtpScreen      goto={setScreen}/>;
  else if (screen === 'home')     content = <HomeScreen     ctx={ctx} goto={setScreen}/>;
  else if (screen === 'attend')   content = <AttendanceScreen ctx={ctx} goto={setScreen}/>;
  else if (screen === 'punya')    content = <PunyaScreen    ctx={ctx} goto={setScreen}/>;
  else if (screen === 'notices')  content = <NoticesScreen  goto={setScreen}/>;
  else if (screen === 'notice')   content = <NoticeDetail   goto={setScreen}/>;
  else if (screen === 'profile')  content = <ProfileScreen  ctx={ctx} goto={setScreen}/>;

  const showTabs = ['home','attend','punya','notices','profile'].includes(screen);

  return (
    <IOSDevice width={390} height={844} keyboard={false}>
      <div style={{ height:'100%', position:'relative', background: JP.cream, overflow:'hidden' }}>
        <div style={{ position:'absolute', inset: '44px 0 ' + (showTabs ? '80px' : '0') + ' 0', overflow:'auto' }}>
          {content}
        </div>
        {showTabs && <TabBar active={
          screen === 'home' ? 'home' :
          screen === 'attend' ? 'attend' :
          screen === 'punya' ? 'punya' :
          screen === 'notice' || screen === 'notices' ? 'notices' :
          screen === 'profile' ? 'profile' : null
        } onChange={k => setScreen(k === 'notices' ? 'notices' : k)}/>}
      </div>
    </IOSDevice>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
