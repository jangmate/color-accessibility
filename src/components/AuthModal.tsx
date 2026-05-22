import { useState } from 'react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (userData: { id: number; username: string }) => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('아이디와 비밀번호를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = isLogin ? '/api/login' : '/api/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '요청 중 오류가 발생했습니다.');
      }

      if (isLogin) {
        onSuccess(data.user);
      } else {
        // 회원가입 성공 시 자동 로그인 처리 또는 알림 후 로그인 모드로 전환
        setIsLogin(true);
        setError('회원가입이 완료되었습니다. 로그인해주세요.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청 실패');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-modal-overlay">
      <div className="auth-modal">
        <button className="auth-modal__close" onClick={onClose}>×</button>
        <h2 className="auth-modal__title">{isLogin ? '로그인' : '회원가입'}</h2>

        {error && <div className="auth-modal__error" style={{ color: isLogin && error.includes('완료') ? 'green' : 'inherit' }}>{error}</div>}

        <form onSubmit={handleSubmit} className="auth-modal__form" autoComplete="off">
          <div className="form-group">
            <label>아이디</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="아이디를 입력하세요"
              autoComplete="off"
            />
          </div>
          <div className="form-group">
            <label>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn btn--primary auth-modal__submit" disabled={loading}>
            {loading ? '처리 중...' : (isLogin ? '로그인' : '가입하기')}
          </button>
        </form>

        <div className="auth-modal__toggle">
          {isLogin ? (
            <p>계정이 없으신가요? <button onClick={() => { setIsLogin(false); setError(''); }}>회원가입</button></p>
          ) : (
            <p>이미 계정이 있으신가요? <button onClick={() => { setIsLogin(true); setError(''); }}>로그인</button></p>
          )}
        </div>
      </div>
    </div>
  );
}
