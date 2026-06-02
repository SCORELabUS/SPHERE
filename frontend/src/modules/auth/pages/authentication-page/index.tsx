import { useSearchParams } from 'react-router-dom';
import AuthLayout from '../../components/auth-layout';
import LoginForm from '../../components/login-form';
import RegisterForm from '../../components/register-form';

export default function AuthenticationPage() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view');

  return (
    <AuthLayout>
      {view === 'register' ? <RegisterForm /> : <LoginForm />}
    </AuthLayout>
  );
}
