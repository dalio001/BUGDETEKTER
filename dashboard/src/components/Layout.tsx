import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

const links = [
  { to: '/', label: 'Overview' },
  { to: '/issues', label: 'Issues' },
  { to: '/report', label: 'Report a bug' },
  { to: '/projects', label: 'Projects' },
  { to: '/tokens', label: 'API tokens' }
];

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="logo">
          Bug<span>Detekter</span>
        </div>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === '/'}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
        <div className="sidebar-footer">
          {user?.email}
          <br />
          <button onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
