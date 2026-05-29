import React, { useState, useEffect } from 'react';
import { BookOpen, Loader2, Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import { login as apiLogin, signup as apiSignup } from './authApi';

/**
 * Combined login / signup screen shown before the app loads.
 * Matches the app's blue/indigo gradient theme.
 *
 * Props:
 *   onAuthSuccess(user) — called once a session cookie is established.
 */
export default function AuthPage({ onAuthSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    email: '',
    institute: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Surface the email-verification redirect result (?verified=success|already).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('verified');
    if (v === 'success') setNotice('Your email is verified — you can now log in.');
    else if (v === 'already') setNotice('This link was already used. Please log in.');
    if (v) {
      const url = new URL(window.location.href);
      url.searchParams.delete('verified');
      window.history.replaceState({}, '', url);
    }
  }, []);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        const res = await apiSignup(form);
        if (res?.email_sent) {
          setNotice(
            'Account created! Please check your email and click the verification link.'
          );
        }
        onAuthSuccess(res.user);
      } else {
        const res = await apiLogin({
          username: form.username,
          password: form.password,
        });
        onAuthSuccess(res.user);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="relative min-h-screen w-screen overflow-hidden flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50 px-4 py-10">
      {/* Decorative background blobs (matches HomePage) */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[34rem] h-[34rem] rounded-full bg-blue-200/40 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[36rem] h-[36rem] rounded-full bg-indigo-200/40 blur-3xl" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30 mb-3">
            <BookOpen className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
            RenAIssance OCR
          </h1>
          <p className="text-sm text-gray-500">Historical document processing</p>
        </div>

        {/* Card */}
        <div className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded-2xl shadow-xl shadow-blue-500/10 p-7">
          {/* Tabs */}
          <div className="flex p-1 mb-6 bg-gray-100 rounded-xl">
            {['login', 'signup'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                  mode === m
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {m === 'login' ? 'Log in' : 'Sign up'}
              </button>
            ))}
          </div>

          {notice && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm animate-fade-in">
              {notice.toLowerCase().includes('verif') ? (
                <Mail className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm animate-fade-in">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field
              label="Username"
              value={form.username}
              onChange={update('username')}
              autoComplete="username"
              required
              placeholder={isSignup ? 'Choose a username' : 'Username or email'}
            />

            {isSignup && (
              <>
                <Field
                  label="Full name"
                  value={form.name}
                  onChange={update('name')}
                  autoComplete="name"
                  required
                  placeholder="Your name"
                />
                <Field
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={update('email')}
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                />
                <Field
                  label="Institute"
                  optional
                  value={form.institute}
                  onChange={update('institute')}
                  autoComplete="organization"
                  placeholder="University / organization"
                />
              </>
            )}

            <Field
              label="Password"
              type="password"
              value={form.password}
              onChange={update('password')}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              required
              placeholder={isSignup ? 'At least 6 characters' : 'Your password'}
              minLength={isSignup ? 6 : undefined}
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 mt-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold shadow-lg shadow-blue-500/30 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading
                ? 'Please wait…'
                : isSignup
                ? 'Create account'
                : 'Log in'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={() => switchMode(isSignup ? 'login' : 'signup')}
              className="font-semibold text-blue-600 hover:text-blue-700"
            >
              {isSignup ? 'Log in' : 'Sign up'}
            </button>
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          RenAIssance Project · sign in to continue
        </p>
      </div>
    </div>
  );
}

function Field({ label, optional, type = 'text', ...props }) {
  return (
    <label className="block">
      <span className="block mb-1 text-sm font-medium text-gray-700">
        {label}
        {optional && <span className="ml-1 text-xs text-gray-400">(optional)</span>}
      </span>
      <input
        type={type}
        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400 transition-all duration-200"
        {...props}
      />
    </label>
  );
}
