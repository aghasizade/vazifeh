import { createContext, useContext } from 'react';

// Signed-in user plus reference data (/api/meta) shared by every page.
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export const isBoss = (user) => user?.role === 'ceo' || user?.role === 'admin';
export const isManager = (user) => isBoss(user) || user?.role === 'supervisor';

export const ROLE_LABEL = { ceo: 'مدیر عامل', admin: 'مدیر سامانه', supervisor: 'سرپرست واحد', employee: 'کارمند' };
