import { loadStudio } from '@/lib/studio';
import { requireAdmin } from '@/lib/admin';
import { Studio } from '@/components/studio';
export default async function Page(){const [{profile},data]=await Promise.all([requireAdmin(),loadStudio()]);return <Studio initial={data} userName={profile.first_name||'Superadmin'}/>}
