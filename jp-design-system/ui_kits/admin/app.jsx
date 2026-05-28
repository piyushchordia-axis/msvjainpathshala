// Web admin app — sidebar + topbar + content area.
const { useState } = React;

function AdminApp() {
  const [role, setRole] = useState('cityAdmin');
  const [screen, setScreen] = useState('dashboard');
  React.useEffect(() => { window.__adminSetScreen = setScreen; window.__adminSetRole = setRole; }, []);

  const titles = {
    dashboard:'Dashboard', students:'Students', centres:'Centres',
    notices:'Notices', punya:'Punya rules', audit:'Audit log',
    cities:'Cities', billing:'Billing', attendance:'Attendance',
  };

  let body;
  if (screen === 'dashboard') body = <DashboardScreen role={role}/>;
  else if (screen === 'students') body = <StudentsScreen/>;
  else if (screen === 'notices') body = <NoticesScreen/>;
  else if (screen === 'audit') body = <AuditScreen/>;
  else body = (
    <div style={{ padding:48, color:JP.textSub, textAlign:'center' }}>
      <div style={{ fontFamily:JP.display, color:JP.maroon, fontSize:22 }}>{titles[screen] || screen}</div>
      <div style={{ marginTop:8, fontSize:13 }}>This screen is part of the production app; not mocked in the kit.</div>
    </div>
  );

  return (
    <ChromeWindow tabs={[{ title:'Jain Pathshala · Admin' }]} url="admin.jainpathshala.app" width={1280} height={780}>
      <div style={{ display:'flex', height:'100%', background:JP.cream, fontFamily:JP.body, color:JP.textPrimary }}>
        <Sidebar role={role} active={screen} onChange={setScreen}/>
        <main style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto' }}>
          <Topbar title={titles[screen] || screen} role={role} onRole={setRole}/>
          {body}
        </main>
      </div>
    </ChromeWindow>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AdminApp/>);
