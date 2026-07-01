import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  ArrowDownUp,
  Banknote,
  CheckCircle2,
  Clock3,
  FileText,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  ShieldCheck,
  Upload,
  UserRound,
  XCircle,
} from "lucide-react";
import type { Contribution, InvestmentProject, Profile } from "./types";
import {
  calculateTotals,
  getActiveProject,
  getAdminContributions,
  getCurrentProfile,
  getMemberContributions,
  getSignedReceiptUrl,
  reviewContribution,
  submitContribution,
  updateProfile,
} from "./lib/investmentApi";
import { formatBdt, formatDate, fileSizeLabel } from "./lib/format";
import { hasSupabaseConfig, supabase } from "./lib/supabase";

type ViewMode = "member" | "admin";

const allowedReceiptTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];

const phoneCountryCodes = [
  { label: "Bangladesh", code: "+880" },
  { label: "Saudi Arabia", code: "+966" },
  { label: "United Arab Emirates", code: "+971" },
  { label: "Qatar", code: "+974" },
  { label: "Kuwait", code: "+965" },
  { label: "Oman", code: "+968" },
  { label: "Bahrain", code: "+973" },
  { label: "Malaysia", code: "+60" },
  { label: "Singapore", code: "+65" },
  { label: "India", code: "+91" },
];

function splitPhoneNumber(phone: string | null | undefined) {
  const cleanPhone = phone?.trim() ?? "";
  const matchedCode = phoneCountryCodes
    .map((item) => item.code)
    .sort((a, b) => b.length - a.length)
    .find((code) => cleanPhone.startsWith(code));

  return {
    code: matchedCode ?? "+880",
    number: matchedCode ? cleanPhone.slice(matchedCode.length).trim() : cleanPhone,
  };
}

function joinPhoneNumber(code: string, number: string) {
  const cleanNumber = number.replace(/[^\d]/g, "");
  return cleanNumber ? `${code}${cleanNumber}` : null;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoadingSession(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoadingSession(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  if (!hasSupabaseConfig) return <SetupNotice />;
  if (loadingSession) return <PageShell><StatusMessage title="Opening your dashboard" body="Checking your login session." /></PageShell>;
  if (!session) return <AuthScreen />;

  return <InvestmentApp session={session} />;
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err && typeof err.message === "string") return err.message;
  return fallback;
}

function InvestmentApp({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [project, setProject] = useState<InvestmentProject | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [mode, setMode] = useState<ViewMode>("member");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  async function loadData(nextMode = mode) {
    setLoading(true);
    setError(null);
    try {
      const [profileData, projectData] = await Promise.all([
        getCurrentProfile(session.user.id),
        getActiveProject(),
      ]);

      setProfile(profileData);
      setProject(projectData);

      const contributionData = nextMode === "admin" && profileData?.role === "admin"
        ? await getAdminContributions()
        : await getMemberContributions(session.user.id);

      setContributions(contributionData);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load investment data."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData("member");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function switchMode(nextMode: ViewMode) {
    setMode(nextMode);
    await loadData(nextMode);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const totals = useMemo(() => calculateTotals(contributions), [contributions]);
  const target = Number(project?.target_amount_bdt ?? 0);
  const progress = target > 0 ? Math.min(100, (totals.approved / target) * 100) : 0;

  return (
    <PageShell>
      <header className="app-header">
        <div>
          <p className="eyebrow">Private investment ledger</p>
          <h1>{project?.name ?? "Land & Home Investment"}</h1>
        </div>
        <div className="header-actions">
          {isAdmin && (
            <div className="segmented-control" aria-label="Dashboard mode">
              <button className={mode === "member" ? "active" : ""} onClick={() => void switchMode("member")}>
                <UserRound size={16} /> Member
              </button>
              <button className={mode === "admin" ? "active" : ""} onClick={() => void switchMode("admin")}>
                <ShieldCheck size={16} /> Admin
              </button>
            </div>
          )}
          <button className="icon-button" type="button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {message && <InlineNotice tone="success" text={message} onClose={() => setMessage(null)} />}
      {error && <InlineNotice tone="error" text={error} onClose={() => setError(null)} />}

      <section className="summary-grid">
        <MetricCard icon={<Banknote />} label="Approved fund" value={formatBdt(totals.approved)} />
        <MetricCard icon={<Clock3 />} label="Pending review" value={formatBdt(totals.pending)} />
        <MetricCard icon={<ArrowDownUp />} label="Entries" value={String(totals.totalCount)} />
        <MetricCard icon={<LayoutDashboard />} label="Target progress" value={target > 0 ? `${Math.round(progress)}%` : "No target"} />
      </section>

      {target > 0 && (
        <div className="progress-wrap" aria-label="Investment target progress">
          <div className="progress-labels">
            <span>{formatBdt(totals.approved)}</span>
            <span>{formatBdt(target)}</span>
          </div>
          <div className="progress-bar"><span style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      {loading ? (
        <StatusMessage title="Loading data" body="Reading member records and payment history." />
      ) : mode === "admin" && isAdmin ? (
        <AdminDashboard
          contributions={contributions}
          reviewerId={session.user.id}
          onReviewed={async (text) => {
            setMessage(text);
            await loadData("admin");
          }}
          onError={setError}
        />
      ) : (
        <MemberDashboard
          userId={session.user.id}
          profile={profile}
          project={project}
          contributions={contributions}
          onSavedProfile={async () => {
            setMessage("Profile saved.");
            await loadData("member");
          }}
          onSubmitted={async () => {
            setMessage("Payment proof submitted for review.");
            await loadData("member");
          }}
          onError={setError}
        />
      )}
    </PageShell>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: fullName } },
          });

      if (result.error) throw result.error;
      if (mode === "signup") setMessage("Account created. Check email confirmation settings in Supabase if login is blocked.");
    } catch (err) {
      setMessage(getErrorMessage(err, "Authentication failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell compact>
      <main className="auth-layout">
        <section className="auth-copy">
          <p className="eyebrow">Home Investment</p>
          <h1>Contribution records for the land and home fund</h1>
          <p>Members can submit payment proof and track approved BDT contributions. Admins can review receipts and keep the ledger clean.</p>
        </section>
        <form className="panel auth-panel" onSubmit={(event) => void submit(event)}>
          <div className="segmented-control full">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
            <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Create account</button>
          </div>
          {mode === "signup" && (
            <label>
              Full name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Please wait" : mode === "login" ? "Login" : "Create account"}
          </button>
          {message && <p className="form-message">{message}</p>}
        </form>
      </main>
    </PageShell>
  );
}

function MemberDashboard(props: {
  userId: string;
  profile: Profile | null;
  project: InvestmentProject | null;
  contributions: Contribution[];
  onSavedProfile: () => Promise<void>;
  onSubmitted: () => Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <div className="dashboard-grid">
      <ProfilePanel userId={props.userId} profile={props.profile} onSaved={props.onSavedProfile} onError={props.onError} />
      <PaymentForm
        userId={props.userId}
        project={props.project}
        onSubmitted={props.onSubmitted}
        onError={props.onError}
      />
      <ContributionTable title="My contribution history" contributions={props.contributions} />
    </div>
  );
}

function ProfilePanel({ userId, profile, onSaved, onError }: {
  userId: string;
  profile: Profile | null;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const initialPhone = splitPhoneNumber(profile?.phone);
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phoneCode, setPhoneCode] = useState(initialPhone.code);
  const [phone, setPhone] = useState(initialPhone.number);
  const [country, setCountry] = useState(profile?.resident_country ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const parsedPhone = splitPhoneNumber(profile?.phone);
    setFullName(profile?.full_name ?? "");
    setPhoneCode(parsedPhone.code);
    setPhone(parsedPhone.number);
    setCountry(profile?.resident_country ?? "");
  }, [profile]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await updateProfile({
        id: userId,
        full_name: fullName,
        phone: joinPhoneNumber(phoneCode, phone),
        resident_country: country || null,
      });
      await onSaved();
    } catch (err) {
      onError(getErrorMessage(err, "Could not save profile."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void save(event)}>
      <div className="panel-title">
        <UserRound size={20} />
        <h2>Member profile</h2>
      </div>
      <label>
        Full name
        <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
      </label>
      <label>
        Phone
        <div className="phone-input">
          <select value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} aria-label="Phone country code">
            {phoneCountryCodes.map((item) => (
              <option key={item.code} value={item.code}>
                {item.code} {item.label}
              </option>
            ))}
          </select>
          <input
            inputMode="numeric"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="1712345678"
          />
        </div>
      </label>
      <label>
        Current country
        <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Saudi Arabia, UAE, Qatar..." />
      </label>
      <button className="secondary-button" type="submit" disabled={busy}>{busy ? "Saving" : "Save profile"}</button>
    </form>
  );
}

function PaymentForm({ userId, project, onSubmitted, onError }: {
  userId: string;
  project: InvestmentProject | null;
  onSubmitted: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [bdtAmount, setBdtAmount] = useState("");
  const [sourceCurrency, setSourceCurrency] = useState("");
  const [sourceAmount, setSourceAmount] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [country, setCountry] = useState("");
  const [method, setMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) {
      onError("No active investment project found.");
      return;
    }
    if (!receipt) {
      onError("Attach a PDF, JPG, or PNG payment proof.");
      return;
    }
    if (!allowedReceiptTypes.includes(receipt.type)) {
      onError("Receipt must be PDF, JPG, or PNG.");
      return;
    }

    setBusy(true);
    try {
      await submitContribution({
        projectId: project.id,
        memberId: userId,
        paymentDate,
        bdtAmount: Number(bdtAmount),
        sourceCurrency,
        sourceAmount: sourceAmount ? Number(sourceAmount) : undefined,
        exchangeRate: exchangeRate ? Number(exchangeRate) : undefined,
        sentFromCountry: country,
        paymentMethod: method,
        notes,
        receipt,
      });
      setBdtAmount("");
      setSourceCurrency("");
      setSourceAmount("");
      setExchangeRate("");
      setCountry("");
      setMethod("");
      setNotes("");
      setReceipt(null);
      await onSubmitted();
    } catch (err) {
      onError(getErrorMessage(err, "Could not submit contribution."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel payment-panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-title">
        <Upload size={20} />
        <h2>Submit payment proof</h2>
      </div>
      <div className="form-grid">
        <label>
          Payment date
          <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} required />
        </label>
        <label>
          BDT amount
          <input type="number" min="1" step="0.01" value={bdtAmount} onChange={(event) => setBdtAmount(event.target.value)} required />
        </label>
        <label>
          Source currency
          <input value={sourceCurrency} onChange={(event) => setSourceCurrency(event.target.value.toUpperCase())} placeholder="SAR, AED, QAR" />
        </label>
        <label>
          Source amount
          <input type="number" min="0" step="0.01" value={sourceAmount} onChange={(event) => setSourceAmount(event.target.value)} />
        </label>
        <label>
          Exchange rate
          <input type="number" min="0" step="0.000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} />
        </label>
        <label>
          Sent from
          <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Saudi Arabia" />
        </label>
      </div>
      <label>
        Payment method
        <input value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Bank transfer, cash deposit..." />
      </label>
      <label>
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
      </label>
      <label className="file-picker">
        <FileText size={18} />
        <span>{receipt ? `${receipt.name} (${fileSizeLabel(receipt.size)})` : "Attach PDF, JPG, or PNG receipt"}</span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/jpg"
          onChange={(event) => setReceipt(event.target.files?.[0] ?? null)}
          required
        />
      </label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Submitting" : "Submit for review"}</button>
    </form>
  );
}

function AdminDashboard({ contributions, reviewerId, onReviewed, onError }: {
  contributions: Contribution[];
  reviewerId: string;
  onReviewed: (message: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const pending = contributions.filter((item) => item.status === "pending");

  async function handleReview(contribution: Contribution, status: "approved" | "rejected") {
    const reason = status === "rejected" ? window.prompt("Reason for rejection?") ?? "Rejected by admin" : undefined;
    try {
      await reviewContribution({
        contributionId: contribution.id,
        reviewerId,
        projectId: contribution.project_id,
        status,
        rejectionReason: reason,
      });
      await onReviewed(status === "approved" ? "Contribution approved." : "Contribution rejected.");
    } catch (err) {
      onError(getErrorMessage(err, "Could not update contribution."));
    }
  }

  return (
    <div className="dashboard-grid">
      <section className="panel wide">
        <div className="panel-title">
          <ShieldCheck size={20} />
          <h2>Pending review</h2>
        </div>
        {pending.length === 0 ? (
          <EmptyState text="No pending payments need review." />
        ) : (
          <div className="review-list">
            {pending.map((contribution) => (
              <ReviewItem
                key={contribution.id}
                contribution={contribution}
                onApprove={() => void handleReview(contribution, "approved")}
                onReject={() => void handleReview(contribution, "rejected")}
              />
            ))}
          </div>
        )}
      </section>
      <ContributionTable title="All contribution records" contributions={contributions} admin />
    </div>
  );
}

function ReviewItem({ contribution, onApprove, onReject }: {
  contribution: Contribution;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const receipt = contribution.payment_receipts?.[0];

  async function openReceipt() {
    if (!receipt) return;
    setOpening(true);
    try {
      const url = await getSignedReceiptUrl(receipt.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setOpening(false);
    }
  }

  return (
    <article className="review-item">
      <div>
        <h3>{contribution.member?.full_name || contribution.member?.email || contribution.profiles?.full_name || contribution.profiles?.email || "Member"}</h3>
        <p>{formatDate(contribution.payment_date)} · {formatBdt(Number(contribution.bdt_amount))}</p>
        <p>{contribution.sent_from_country || "Country not set"} · {contribution.payment_method || "Method not set"}</p>
      </div>
      <div className="review-actions">
        <button className="secondary-button" type="button" onClick={() => void openReceipt()} disabled={!receipt || opening}>
          <ReceiptText size={16} /> {opening ? "Opening" : "Receipt"}
        </button>
        <button className="approve-button" type="button" onClick={onApprove}><CheckCircle2 size={16} /> Approve</button>
        <button className="reject-button" type="button" onClick={onReject}><XCircle size={16} /> Reject</button>
      </div>
    </article>
  );
}

function ContributionTable({ title, contributions, admin = false }: {
  title: string;
  contributions: Contribution[];
  admin?: boolean;
}) {
  return (
    <section className="panel wide">
      <div className="panel-title">
        <ReceiptText size={20} />
        <h2>{title}</h2>
      </div>
      {contributions.length === 0 ? (
        <EmptyState text="No contribution records yet." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {admin && <th>Member</th>}
                <th>Date</th>
                <th>BDT</th>
                <th>Source</th>
                <th>Status</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((contribution) => (
                <tr key={contribution.id}>
                  {admin && <td>{contribution.member?.full_name || contribution.member?.email || contribution.profiles?.full_name || contribution.profiles?.email || "Member"}</td>}
                  <td>{formatDate(contribution.payment_date)}</td>
                  <td>{formatBdt(Number(contribution.bdt_amount))}</td>
                  <td>{contribution.source_currency ? `${contribution.source_currency} ${contribution.source_amount ?? ""}` : contribution.sent_from_country || "BDT"}</td>
                  <td><StatusPill status={contribution.status} /></td>
                  <td>{contribution.payment_receipts?.length ? contribution.payment_receipts[0].file_name : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: Contribution["status"] }) {
  const Icon = status === "approved" ? CheckCircle2 : status === "rejected" ? XCircle : Clock3;
  return <span className={`status-pill ${status}`}><Icon size={14} /> {status}</span>;
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function InlineNotice({ tone, text, onClose }: { tone: "success" | "error"; text: string; onClose: () => void }) {
  return (
    <div className={`inline-notice ${tone}`}>
      {tone === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span>{text}</span>
      <button type="button" onClick={onClose}>Dismiss</button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function StatusMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="status-message">
      <Clock3 size={24} />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function SetupNotice() {
  return (
    <PageShell compact>
      <div className="panel setup-panel">
        <div className="panel-title">
          <AlertCircle size={20} />
          <h1>Supabase environment is missing</h1>
        </div>
        <p>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, then restart the dev server.</p>
      </div>
    </PageShell>
  );
}

function PageShell({ children, compact = false }: { children: React.ReactNode; compact?: boolean }) {
  return <div className={compact ? "page-shell compact" : "page-shell"}>{children}</div>;
}

export default App;
