import { useAuthConfig } from '../../contexts/authConfig';
import { IdentityRedirect } from '../../components/identity-redirect';
import { useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/auth-layout';
import LoginForm from '../../components/login-form';
import RegisterForm from '../../components/register-form';

export default function AuthenticationPage() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view');

  if (useAuthConfig().provider === 'scoretech') return <IdentityRedirect register={view === 'register'} />;
  return (
    <AuthLayout>
      {view === 'register' ? <RegisterForm /> : <LoginForm />}
    </AuthLayout>
  );
}
