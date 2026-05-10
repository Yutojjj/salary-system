import React, { useState, useEffect, useRef } from 'react';
import { Users, FileEdit, FileText, Settings, Plus, Trash2, Printer, ChevronLeft, ChevronRight, Save, Banknote, Star } from 'lucide-react';
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from './firebase';

// ─── 役職マスタ（デフォルト。月別設定で上書き可能） ───────────────────
const DEFAULT_ROLE_MASTER = {
  'T1': { type: '社員', base: 600000 },
  'T2': { type: '社員', base: 550000 },
  'T3': { type: '社員', base: 500000 },
  'M1': { type: '社員', base: 460000 },
  'M2': { type: '社員', base: 440000 },
  'M3': { type: '社員', base: 420000 },
  'L1': { type: '社員', base: 420000 },
  'L2': { type: '社員', base: 400000 },
  'L3': { type: '社員', base: 380000 },
  'L4': { type: '社員', base: 370000 },
  'S1': { type: '社員', base: 360000 },
  'S2': { type: '社員', base: 340000 },
  'S3': { type: '社員', base: 330000 },
  'K':  { type: '社員', base: 330000 },
  'C':  { type: '社員', base: 330000 },
  'D':  { type: '社員', base: 300000 },
  'a1': { type: 'アルバイト', base: 2000 },
  'a2': { type: 'アルバイト', base: 2000 },
  'a3': { type: 'アルバイト', base: 1950 },
  'a4': { type: 'アルバイト', base: 1900 },
  'a5': { type: 'アルバイト', base: 1850 },
  'a6': { type: 'アルバイト', base: 1800 },
  'a7': { type: 'アルバイト', base: 1750 },
  'a8': { type: 'アルバイト', base: 1700 },
  'a9': { type: 'アルバイト', base: 1650 },
  'a10':{ type: 'アルバイト', base: 1600 },
  'Ka': { type: 'アルバイト', base: 1500 },
  'Ca': { type: 'アルバイト', base: 1500 },
};

const iCls = "w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-white";
const rCls = "w-full px-3 py-2.5 border border-slate-100 rounded-lg text-sm bg-slate-50 text-slate-700 font-medium";
const lCls = "block text-xs font-medium text-slate-500 mb-1.5";

// 月ラベル
const fmtMonth = (m) => {
  const [y, mo] = m.split('-');
  return `${y}年${parseInt(mo)}月`;
};

// 月移動
const shiftMonth = (m, delta) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ── 数値入力用カスタムコンポーネント（全角→半角変換、0消去不可対策） ──
const NumInput = ({ value, onChange, className, placeholder, readOnly }) => {
  const [local, setLocal] = useState('');

  useEffect(() => {
    if (value === 0 || value === '0') {
      setLocal('');
    } else {
      setLocal(value !== undefined ? String(value) : '');
    }
  }, [value]);

  const handleChange = (e) => {
    let val = e.target.value;
    // 全角数字を半角数字に変換し、数字とマイナス・ピリオド以外を削除
    val = val.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
             .replace(/[^0-9.-]/g, '');
    setLocal(val);
    const num = parseFloat(val);
    onChange(isNaN(num) ? 0 : num);
  };

  const handleBlur = () => {
    let num = parseFloat(local);
    if (isNaN(num)) num = 0;
    if (num === 0) {
      setLocal('');
      onChange(0);
    } else {
      setLocal(String(num));
      onChange(num);
    }
  };

  return (
    <input
      type="text"
      value={local}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
      placeholder={placeholder || "0"}
      readOnly={readOnly}
    />
  );
};


// ── 金種管理（元：お釣り計算） ─────────────────────────────────────────────────────────
const DENOMINATIONS = [
  { label: '10,000円札', value: 10000 },
  { label: '5,000円札', value: 5000 },
  { label: '1,000円札', value: 1000 },
  { label: '500円玉', value: 500 },
  { label: '100円玉', value: 100 },
  { label: '50円玉', value: 50 },
  { label: '10円玉', value: 10 },
  { label: '5円玉', value: 5 },
  { label: '1円玉', value: 1 },
];

// 1人分の金額を個別両替して枚数を返す
function breakdownSingle(amount) {
  let remaining = Math.max(0, Math.round(amount));
  return DENOMINATIONS.map(d => {
    const count = Math.floor(remaining / d.value);
    remaining -= count * d.value;
    return count;
  });
}

// 複数人の個別両替結果を合算する
function calcBreakdownByPerson(netAmounts) {
  const totals = new Array(DENOMINATIONS.length).fill(0);
  netAmounts.forEach(amount => {
    const counts = breakdownSingle(amount);
    counts.forEach((c, i) => { totals[i] += c; });
  });
  return DENOMINATIONS.map((d, i) => ({ ...d, count: totals[i] }));
}

export default function App() {
  const [activeTab, setActiveTab] = useState('accounts');
  const [currentMonth, setCurrentMonth] = useState(new Date().toISOString().slice(0, 7));

  const [settings, setSettings] = useState({
    businessDays: 25, totalCommission: 0, dormRent: 0, dormStockTarget: 0,
    healthInsRate: 0, nursingInsRate: 0, pensionRate: 0, empInsRate: 0,
  });

  const [accounts, setAccounts] = useState([]);
  const [monthlyRecords, setMonthlyRecords] = useState({});
  const [monthlySettings, setMonthlySettings] = useState({});
  const [roleMaster, setRoleMaster] = useState(DEFAULT_ROLE_MASTER);

  useEffect(() => {
    // Firebase Firestoreからリアルタイム同期
    const unsub = onSnapshot(doc(db, "salary_data", "main"), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.settings) setSettings(data.settings);
        if (data.accounts) setAccounts(data.accounts);
        if (data.monthlyRecords) setMonthlyRecords(data.monthlyRecords);
        if (data.monthlySettings) setMonthlySettings(data.monthlySettings);
        if (data.roleMaster) setRoleMaster(data.roleMaster);
      }
    });
    return () => unsub();
  }, []);

  const saveAllData = async (newData) => {
    try {
      await setDoc(doc(db, "salary_data", "main"), newData, { merge: true });
    } catch (error) {
      console.error("Firebaseへの保存に失敗しました:", error);
      alert("データの保存に失敗しました。通信環境を確認してください。");
    }
  };

  const saveAccounts = (newAccounts) => {
    setAccounts(newAccounts);
    saveAllData({ accounts: newAccounts });
  };
  const saveRecords = (newRecords) => {
    setMonthlyRecords(newRecords);
    saveAllData({ monthlyRecords: newRecords });
  };
  const saveMonthlySettings = (newMs) => {
    setMonthlySettings(newMs);
    const cur = newMs[currentMonth];
    if (cur) {
      setSettings(cur);
      saveAllData({ monthlySettings: newMs, settings: cur });
    } else {
      saveAllData({ monthlySettings: newMs });
    }
  };
  const saveRoleMaster = (rm) => {
    setRoleMaster(rm);
    saveAllData({ roleMaster: rm });
  };

  const getMonthSettings = (month) => {
    if (monthlySettings[month]) return monthlySettings[month];
    const prev = shiftMonth(month, -1);
    if (monthlySettings[prev]) return { ...monthlySettings[prev] };
    return {
      businessDays: 25, totalCommission: 0, dormRent: 0, dormStockTarget: 0,
      healthInsRate: 0, nursingInsRate: 0, pensionRate: 0, empInsRate: 0,
      baseSalary: 0, roleAllowances: {}, partRoleAllowances: {},
    };
  };

  const currentSettings = getMonthSettings(currentMonth);

  const navItems = [
    { tab: 'accounts', icon: Users, label: 'アカウント管理' },
    { tab: 'settings', icon: Settings, label: '月別設定' },
    { tab: 'allowances', icon: Star, label: '役職手当設定' },
    { tab: 'input', icon: FileEdit, label: '明細入力' },
    { tab: 'slips', icon: FileText, label: '明細出力' },
    { tab: 'cash', icon: Banknote, label: '金種管理' },
  ];

  const pageTitles = {
    settings: '月別共通設定',
    accounts: 'アカウント管理',
    allowances: '役職手当設定',
    input: '明細入力',
    slips: '明細出力',
    cash: '金種管理',
  };

  // ═══════════════════════════════════════════════════════════
  // ① 月別設定画面
  // ═══════════════════════════════════════════════════════════
  const SettingsScreen = () => {
    const [local, setLocal] = useState(() => getMonthSettings(currentMonth));
    const [savedMonth, setSavedMonth] = useState(currentMonth);
    const [notify, setNotify] = useState(false);

    if (savedMonth !== currentMonth) {
      setSavedMonth(currentMonth);
      setLocal(getMonthSettings(currentMonth));
    }

    const ch = (e) => setLocal(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSave = () => {
      const parsed = {
        ...local,
        businessDays: parseFloat(local.businessDays) || 0,
        totalCommission: parseFloat(local.totalCommission) || 0,
        dormRent: parseFloat(local.dormRent) || 0,
        dormStockTarget: parseFloat(local.dormStockTarget) || 0,
        healthInsRate: parseFloat(local.healthInsRate) || 0,
        nursingInsRate: parseFloat(local.nursingInsRate) || 0,
        pensionRate: parseFloat(local.pensionRate) || 0,
        empInsRate: parseFloat(local.empInsRate) || 0,
        baseSalary: parseFloat(local.baseSalary) || 0,
        roleAllowances: local.roleAllowances || {},
        partRoleAllowances: local.partRoleAllowances || {},
      };
      const newMs = { ...monthlySettings, [currentMonth]: parsed };
      saveMonthlySettings(newMs);
      setNotify(true);
      setTimeout(() => setNotify(false), 2500);
    };

    const isInherited = !monthlySettings[currentMonth];

    return (
      <div className="space-y-4 max-w-2xl">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-center gap-6">
            <button onClick={() => setCurrentMonth(m => shiftMonth(m, -1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 text-xl font-bold transition-colors select-none"><ChevronLeft /></button>
            <span className="text-xl font-bold text-slate-800 min-w-[160px] text-center">{fmtMonth(currentMonth)}</span>
            <button onClick={() => setCurrentMonth(m => shiftMonth(m, 1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 text-xl font-bold transition-colors select-none"><ChevronRight /></button>
          </div>
          {isInherited && <p className="text-center text-xs text-amber-500 mt-2">※ 前月の設定を引き継いでいます（保存すると確定します）</p>}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-7">
          <h2 className="text-sm font-bold text-slate-800 mb-6">基本設定</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5">
            <div>
              <label className={lCls}>営業日数 (日)</label>
              <NumInput value={local.businessDays} onChange={val => setLocal(p => ({...p, businessDays: val}))} className={iCls} />
            </div>
            <div>
              <label className={lCls}>歩合総額 (円)</label>
              <NumInput value={local.totalCommission} onChange={val => setLocal(p => ({...p, totalCommission: val}))} className={iCls} />
            </div>
            <div>
              <label className={lCls}>社員 共通基本給 (円) ※一律設定</label>
              <NumInput value={local.baseSalary} onChange={val => setLocal(p => ({...p, baseSalary: val}))} className={iCls} placeholder="300000" />
              <p className="text-xs text-slate-400 mt-1">全社員に適用される月額基本給。ここで設定した額が役職手当に加算されます。</p>
            </div>
            <div>
              <label className={lCls}>通常 寮家賃 (円)</label>
              <NumInput value={local.dormRent} onChange={val => setLocal(p => ({...p, dormRent: val}))} className={iCls} />
            </div>
            <div className="col-span-2 bg-teal-50 p-4 rounded-xl border border-teal-200">
              <label className="block text-xs font-bold text-teal-800 mb-1.5">寮費ストック 目標額 (円/人)</label>
              <NumInput value={local.dormStockTarget} onChange={val => setLocal(p => ({...p, dormStockTarget: val}))} className="w-1/2 px-3 py-2.5 border border-teal-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white" placeholder="例: 50000" />
              <p className="text-[11px] text-teal-700 mt-1.5 leading-relaxed">寮利用者が家賃を払えない月に備えた1ヶ月分などの事前ストック目標額です。この目標額に向けて毎月分割または一括で天引きを行い、不足時はここから充当（使用）します。</p>
            </div>
          </div>

          <div className="mt-7">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">社会保険料率</p>
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: '健康保険 (%)', name: 'healthInsRate' },
                { label: '介護保険 (%)', name: 'nursingInsRate' },
                { label: '厚生年金 (%)', name: 'pensionRate' },
                { label: '雇用保険 (%)', name: 'empInsRate' },
              ].map(({ label, name }) => (
                <div key={name}>
                  <label className={lCls}>{label}</label>
                  <NumInput value={local[name]} onChange={val => setLocal(p => ({...p, [name]: val}))} className={iCls} />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 flex items-center gap-4">
            <button onClick={handleSave} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2">
              <Save size={15} /> 保存
            </button>
            {notify && <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 text-green-700 rounded-xl text-sm font-medium">✓ {fmtMonth(currentMonth)}の設定を保存しました</div>}
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // 役職手当設定画面（グループ横並び）
  // ═══════════════════════════════════════════════════════════
  const AllowancesScreen = () => {
    const [empType, setEmpType] = useState('社員');
    const [notify, setNotify] = useState(false);
    const ms = getMonthSettings(currentMonth);
    const key = empType === '社員' ? 'roleAllowances' : 'partRoleAllowances';
    const [allowances, setAllowances] = useState(() => ms[key] || {});
    const [savedMonth, setSavedMonth] = useState(currentMonth);
    
    if (savedMonth !== currentMonth) {
      setSavedMonth(currentMonth);
      const fresh = getMonthSettings(currentMonth);
      setAllowances(fresh[key] || {});
    }

    const roles = Object.entries(roleMaster).filter(([, d]) => d.type === (empType === '社員' ? '社員' : 'アルバイト'));

    const groups = {};
    roles.forEach(([k]) => {
      const g = k.replace(/[0-9]/g, '');
      if (!groups[g]) groups[g] = [];
      groups[g].push(k);
    });

    const handleSave = () => {
      const existing = getMonthSettings(currentMonth);
      const parsed = {};
      roles.forEach(([k]) => { parsed[k] = parseInt(allowances[k] || 0) || 0; });
      const updated = { ...existing, [key]: parsed };
      const newMs = { ...monthlySettings, [currentMonth]: updated };
      saveMonthlySettings(newMs);
      setNotify(true);
      setTimeout(() => setNotify(false), 2500);
    };

    const grpColors = ['bg-blue-50 border-blue-100','bg-purple-50 border-purple-100','bg-green-50 border-green-100','bg-amber-50 border-amber-100','bg-rose-50 border-rose-100','bg-teal-50 border-teal-100','bg-indigo-50 border-indigo-100'];
    const grpHdColors = ['text-blue-700','text-purple-700','text-green-700','text-amber-700','text-rose-700','text-teal-700','text-indigo-700'];

    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-center gap-6">
            <button onClick={() => setCurrentMonth(m => shiftMonth(m, -1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 text-xl font-bold transition-colors select-none"><ChevronLeft /></button>
            <span className="text-xl font-bold text-slate-800 min-w-[160px] text-center">{fmtMonth(currentMonth)}</span>
            <button onClick={() => setCurrentMonth(m => shiftMonth(m, 1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 text-xl font-bold transition-colors select-none"><ChevronRight /></button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-bold text-slate-800">役職手当設定 <span className="text-xs font-normal text-slate-400 ml-1">{fmtMonth(currentMonth)}</span></h2>
            <div className="flex gap-2">
              {['社員', 'アルバイト'].map(t => (
                <button key={t} onClick={() => {
                  const fresh = getMonthSettings(currentMonth);
                  const k2 = t === '社員' ? 'roleAllowances' : 'partRoleAllowances';
                  setAllowances(fresh[k2] || {});
                  setEmpType(t);
                }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${empType === t ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{t}</button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            {Object.entries(groups).map(([grpKey, members], gi) => (
              <div key={grpKey} className={`rounded-xl border p-4 ${grpColors[gi % grpColors.length]}`}>
                <div className={`text-xs font-bold uppercase tracking-widest mb-3 ${grpHdColors[gi % grpHdColors.length]}`}>{grpKey} グループ</div>
                <div className="flex flex-wrap gap-3">
                  {members.map(k => (
                    <div key={k} className="flex flex-col items-center gap-1 min-w-[80px]">
                      <span className="text-xs font-bold font-mono text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">{k}</span>
                      <div className="relative w-[80px]">
                        <NumInput
                          value={allowances[k]}
                          onChange={val => setAllowances(prev => ({ ...prev, [k]: val }))}
                          className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                          placeholder="0"
                        />
                      </div>
                      <span className="text-[10px] text-slate-400">円</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-4">
            <button onClick={handleSave} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2">
              <Save size={15} /> 保存
            </button>
            {notify && <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 text-green-700 rounded-xl text-sm font-medium">✓ 役職手当を保存しました</div>}
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // ② アカウント管理
  // ═══════════════════════════════════════════════════════════
  const AccountsScreen = () => {
    const [newAccount, setNewAccount] = useState({ name: '', type: '社員', role: 'T1', joinDate: '', referralIds: [] });
    const [editingId, setEditingId] = useState(null);
    const [editData, setEditData] = useState({});

    const handleAdd = () => {
      if (!newAccount.name) return;
      saveAccounts([...accounts, { ...newAccount, id: Date.now().toString() }]);
      setNewAccount({ name: '', type: '社員', role: 'T1', joinDate: '', referralIds: [] });
    };
    const handleDelete = (id) => { if (editingId === id) setEditingId(null); saveAccounts(accounts.filter(a => a.id !== id)); };
    const startEdit = (a) => { setEditingId(a.id); setEditData({ ...a }); };
    const cancelEdit = () => setEditingId(null);
    const saveEdit = () => { saveAccounts(accounts.map(a => a.id === editingId ? { ...editData } : a)); setEditingId(null); };

    const TypeBadge = ({ type }) => (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${type === '社員' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{type}</span>
    );

    const ReferralSelector = ({ value, onChange, excludeId }) => {
      const [open, setOpen] = useState(false);
      const candidates = accounts.filter(a => a.id !== excludeId);
      const selectedNames = value.map(id => accounts.find(a => a.id === id)?.name).filter(Boolean);
      const toggleId = (id) => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
      return (
        <div className="relative">
          <button type="button" onClick={() => setOpen(o => !o)} className={`${iCls} text-left flex items-center justify-between`} style={{ color: value.length === 0 ? '#94a3b8' : 'inherit' }}>
            <span className="truncate">{value.length === 0 ? '紹介先を選択' : selectedNames.join(', ')}</span>
            <span className="ml-1 text-slate-400 text-xs">▼</span>
          </button>
          {open && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {candidates.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">対象者なし</div>}
              {candidates.map(acc => (
                <label key={acc.id} className="flex items-center gap-2 px-3 py-2 hover:bg-indigo-50 cursor-pointer text-sm">
                  <input type="checkbox" checked={value.includes(acc.id)} onChange={() => toggleId(acc.id)} className="accent-indigo-600" />
                  {acc.name}
                </label>
              ))}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-5">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h3 className="text-sm font-bold text-slate-700 mb-4">新規アカウント追加</h3>
          <div className="grid grid-cols-6 gap-3 items-end">
            <div>
              <label className={lCls}>氏名</label>
              <input type="text" value={newAccount.name} onChange={e => setNewAccount({ ...newAccount, name: e.target.value })} className={iCls} placeholder="田中 太郎" />
            </div>
            <div>
              <label className={lCls}>雇用形態</label>
              <select value={newAccount.type} onChange={e => setNewAccount({ ...newAccount, type: e.target.value, role: e.target.value === '社員' ? 'T1' : 'a1' })} className={iCls}>
                <option value="社員">社員</option>
                <option value="アルバイト">アルバイト</option>
              </select>
            </div>
            <div>
              <label className={lCls}>役職</label>
              <select value={newAccount.role} onChange={e => setNewAccount({ ...newAccount, role: e.target.value })} className={iCls}>
                {Object.entries(roleMaster).filter(([, d]) => d.type === newAccount.type).map(([k]) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div>
              <label className={lCls}>入店日 (任意)</label>
              <input type="date" value={newAccount.joinDate} onChange={e => setNewAccount({ ...newAccount, joinDate: e.target.value })} className={iCls} />
            </div>
            <div>
              <label className={lCls}>紹介先</label>
              <ReferralSelector value={newAccount.referralIds} onChange={ids => setNewAccount({ ...newAccount, referralIds: ids })} excludeId={null} />
            </div>
            <div>
              <button onClick={handleAdd} className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5 shadow-sm">
                <Plus size={15} /> 追加
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-700">登録済みアカウント</h3>
            <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-medium">{accounts.length} 名</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/60 border-b border-slate-100">
                {['氏名', '雇用形態', '役職', '入店日', '紹介先', '操作'].map((h, i) => (
                  <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {accounts.map(account => {
                if (editingId === account.id) {
                  return (
                    <tr key={account.id} className="bg-indigo-50/40">
                      <td className="px-4 py-2"><input type="text" value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} className={iCls} /></td>
                      <td className="px-4 py-2">
                        <select value={editData.type} onChange={e => setEditData({ ...editData, type: e.target.value, role: e.target.value === '社員' ? 'T1' : 'a1' })} className={iCls}>
                          <option value="社員">社員</option>
                          <option value="アルバイト">アルバイト</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <select value={editData.role} onChange={e => setEditData({ ...editData, role: e.target.value })} className={iCls}>
                          {Object.entries(roleMaster).filter(([, d]) => d.type === editData.type).map(([k]) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2"><input type="date" value={editData.joinDate} onChange={e => setEditData({ ...editData, joinDate: e.target.value })} className={iCls} /></td>
                      <td className="px-4 py-2">
                        <ReferralSelector value={editData.referralIds || []} onChange={ids => setEditData({ ...editData, referralIds: ids })} excludeId={account.id} />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <button onClick={saveEdit} className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700">保存</button>
                          <button onClick={cancelEdit} className="px-2.5 py-1 bg-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-300">取消</button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={account.id} className="hover:bg-indigo-50/30 transition-colors">
                    <td className="px-4 py-3.5 font-semibold text-slate-800">{account.name}</td>
                    <td className="px-4 py-3.5"><TypeBadge type={account.type} /></td>
                    <td className="px-4 py-3.5 text-slate-600 font-mono text-xs">{account.role}</td>
                    <td className="px-4 py-3.5 text-slate-500">{account.joinDate || '—'}</td>
                    <td className="px-4 py-3.5 text-slate-500">{account.referralIds?.map(id => accounts.find(a => a.id === id)?.name).filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(account)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><FileEdit size={15} /></button>
                        <button onClick={() => handleDelete(account.id)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {accounts.length === 0 && <tr><td colSpan={6} className="px-6 py-14 text-center text-slate-400 text-sm">アカウントがまだ登録されていません</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // ③ 明細入力画面（モーダルポップアップ）
  // ═══════════════════════════════════════════════════════════
  const InputScreen = () => {
    const [empType, setEmpType] = useState('社員');
    const [selectedId, setSelectedId] = useState(null);
    const filtered = accounts.filter(a => a.type === empType);
    const currentRecords = monthlyRecords[currentMonth] || {};
    const isInputDone = (acc) => !!currentRecords[acc.id];

    return (
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
          {['社員', 'アルバイト'].map(t => (
            <button key={t} onClick={() => { setEmpType(t); setSelectedId(null); }}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${empType === t ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{t}</button>
          ))}
          <span className="ml-auto text-xs text-slate-400">{fmtMonth(currentMonth)} ／ 名前をクリックして入力</span>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          {filtered.length === 0 && <p className="text-slate-400 text-sm text-center py-8">{empType}のアカウントがありません</p>}
          <div className="flex flex-wrap gap-3">
            {filtered.map(acc => {
              const done = isInputDone(acc);
              return (
                <button key={acc.id} onClick={() => setSelectedId(acc.id)}
                  className={`px-5 py-3 rounded-xl text-sm font-semibold border-2 transition-all min-w-[100px] text-center
                    ${done ? 'bg-green-50 text-green-700 border-green-200 hover:border-green-400'
                           : 'bg-white text-red-500 border-red-200 hover:border-red-400'}`}>
                  {acc.name}
                  {done ? <span className="block text-xs mt-0.5 font-normal opacity-80">✓ 入力済</span>
                        : <span className="block text-xs mt-0.5 font-normal">未入力</span>}
                </button>
              );
            })}
          </div>
        </div>
        {selectedId && (() => {
          const acc = accounts.find(a => a.id === selectedId);
          if (!acc) return null;
          return (
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '32px', paddingBottom: '32px', overflowY: 'auto' }}
              onClick={e => { if (e.target === e.currentTarget) setSelectedId(null); }}
            >
              <div style={{ width: '100%', maxWidth: '820px', margin: '0 16px' }} onClick={e => e.stopPropagation()}>
                <MemberInputForm
                  key={`${selectedId}-${currentMonth}`}
                  account={acc}
                  currentMonth={currentMonth}
                  monthlyRecords={monthlyRecords}
                  currentSettings={currentSettings}
                  settings={settings}
                  roleMaster={roleMaster}
                  onClose={() => setSelectedId(null)}
                  onSave={(rec) => {
                    const updated = { ...monthlyRecords, [currentMonth]: { ...(monthlyRecords[currentMonth] || {}), [selectedId]: rec } };
                    saveRecords(updated);
                  }}
                />
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // ─── 個別入力フォーム ─────────────────
  const MemberInputForm = ({ account, currentMonth, monthlyRecords, currentSettings, settings, roleMaster, onSave, onClose }) => {
    const savedRecord = (monthlyRecords[currentMonth] || {})[account.id];
    const prevMonth = shiftMonth(currentMonth, -1);
    const prevRecord = (monthlyRecords[prevMonth] || {})[account.id] || {};
    const [draft, setDraft] = useState(() => savedRecord || {
      ...prevRecord, absence: 0, paidLeave: 0, lateness: 0, workingDays: 0, hours: 0, minutes: 0, stockAddition: 0, stockUsage: 0
    });
    const [notify, setNotify] = useState(false);
    const ms = currentSettings;
    const effectiveBizDays = ms.businessDays || settings.businessDays || 25;
    const isEmployee = account.type === '社員';

    const getBase = () => {
      if (isEmployee && ms.baseSalary && ms.baseSalary > 0) return ms.baseSalary;
      return roleMaster[draft.role || account.role]?.base || 0;
    };
    const getRoleAllowance = () => {
      if (!isEmployee) return ms.partRoleAllowances?.[draft.role || account.role] || 0;
      return ms.roleAllowances?.[draft.role || account.role] || parseFloat(draft.roleAllowance || 0);
    };
    const ch = (name, val) => setDraft(prev => ({ ...prev, [name]: val }));
    const handleCustomItemChange = (index, field, value) => {
      const n = [...(draft.others || [])]; n[index] = { ...n[index], [field]: value };
      setDraft(prev => ({ ...prev, others: n }));
    };
    const addCustomItem = (e) => { e.preventDefault(); setDraft(prev => ({ ...prev, others: [...(prev.others || []), { name: '新規項目', type: '+', amount: 0 }] })); };
    const removeCustomItem = (e, index) => { e.preventDefault(); const n = [...(draft.others || [])]; n.splice(index, 1); setDraft(prev => ({ ...prev, others: n })); };
    const handleSave = (e) => { if (e) e.preventDefault(); onSave(draft); setNotify(true); setTimeout(() => setNotify(false), 2000); };

    const cLbl = "block text-[11px] font-medium text-slate-400 mb-1";
    const cInp = "w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white";
    const cRO  = "w-full px-2 py-1.5 border border-slate-100 rounded-lg text-sm bg-slate-50 text-slate-700 font-medium";
    const Sec = ({ label }) => (
      <div className="col-span-3 flex items-center gap-2 mt-2 mb-0.5">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{label}</span>
        <div className="h-px flex-1 bg-slate-100" />
      </div>
    );

    let calc = {};
    let isEligibleForBonus = false;
    let bonusMonthStr = "";
    
    if (isEmployee) {
      const roleBase = getBase();
      const absenceDays = parseFloat(draft.absence || 0);
      const latenessDays = parseFloat(draft.lateness || 0);
      const roleAllowance = getRoleAllowance();
      
      // 皆勤手当て：遅刻または欠勤が合計1以上なら0円
      const perfectAttendance = (absenceDays + latenessDays) >= 1 ? 0 : 30000;
      // 欠勤控除：欠勤日数 * 30000円
      const absenceDeduction = absenceDays * 30000;
      
      const depAllowance = parseFloat(draft.depAllowance || 0);
      
      // 就社祝い金の判定
      let joinBonus = 0;
      if (account.joinDate) {
        const jd = new Date(account.joinDate), cmd = new Date(currentMonth + '-01');
        const md = (cmd.getFullYear() - jd.getFullYear()) * 12 + cmd.getMonth() - jd.getMonth();
        if (md >= 0 && md <= 5) {
          isEligibleForBonus = true;
          bonusMonthStr = `${md + 1}ヶ月目`;
          if (draft.bonusType === '5万×6ヶ月') joinBonus = 50000;
          else if (draft.bonusType === '半年後に30万' && md === 5) joinBonus = 300000;
        }
      }

      // 寮費ストック（前払準備金）の計算ロジック
      const targetStock = ms.dormStockTarget || settings.dormStockTarget || 0;
      let pastStockAddition = 0;
      let pastStockUsage = 0;
      Object.keys(monthlyRecords).forEach(m => {
        if (m < currentMonth && monthlyRecords[m][account.id]) {
          pastStockAddition += parseFloat(monthlyRecords[m][account.id].stockAddition || 0);
          pastStockUsage += parseFloat(monthlyRecords[m][account.id].stockUsage || 0);
        }
      });
      const pastStockBalance = pastStockAddition - pastStockUsage;
      const currentStockAddition = parseFloat(draft.stockAddition || 0);
      const currentStockUsage = parseFloat(draft.stockUsage || 0);
      const currentStockBalance = pastStockBalance + currentStockAddition - currentStockUsage;
      const stockShortfall = Math.max(0, targetStock - currentStockBalance);
      
      const commissionAmount = Math.floor((ms.totalCommission || settings.totalCommission || 0) * (parseFloat(draft.commissionPct || 0) / 100));
      let othersPlus = 0, othersMinus = 0;
      (draft.others || []).forEach(i => { const a = parseFloat(i.amount || 0); i.type === '+' ? othersPlus += a : othersMinus += a; });
      
      // ストックから充当（使用）した分は、給与の手取りを増やす（補填する）形で相殺するため支給側にプラス計算します
      const totalPayment = roleBase + roleAllowance + perfectAttendance + depAllowance + joinBonus + commissionAmount + currentStockUsage + othersPlus;
      const sr = ms.healthInsRate || settings.healthInsRate || 0;
      // 保険・税金計算時はストック充当分を含めないほうが正確なため、一時的に除外した額で計算
      const taxablePayment = totalPayment - currentStockUsage; 
      const healthIns = draft.healthInsUse ? Math.floor(taxablePayment * (sr / 100)) : 0;
      const withholdingTax = Math.floor((taxablePayment - healthIns) * 0.1021);
      const nursingIns = draft.nursingInsUse ? Math.floor(taxablePayment * ((ms.nursingInsRate || settings.nursingInsRate || 0) / 100)) : 0;
      const pension = draft.pensionUse ? Math.floor(taxablePayment * ((ms.pensionRate || settings.pensionRate || 0) / 100)) : 0;
      const empIns = draft.empInsUse ? Math.floor(taxablePayment * ((ms.empInsRate || settings.empInsRate || 0) / 100)) : 0;
      const dormRent = draft.dormRentUse ? (ms.dormRent || settings.dormRent || 0) : 0;
      const childSupport = parseFloat(draft.childSupport || 0), deposit = parseFloat(draft.deposit || 0);
      const moveOutFee = parseFloat(draft.moveOutFee || 0), dailyAdvance = parseFloat(draft.dailyAdvance || 0);
      
      // ストック積立（追加徴収）は控除として引きます
      const totalDeduction = withholdingTax + healthIns + nursingIns + pension + empIns + dormRent + childSupport + deposit + moveOutFee + dailyAdvance + absenceDeduction + currentStockAddition + othersMinus;
      const netPayment = Math.max(0, totalPayment - totalDeduction);
      
      calc = { 
        attendanceDays: effectiveBizDays - absenceDays, 
        roleBase, roleAllowance, perfectAttendance, absenceDeduction, depAllowance, joinBonus, commissionAmount, 
        totalPayment, withholdingTax, healthIns, nursingIns, pension, empIns, dormRent, 
        totalDeduction, netPayment, 
        pastStockBalance, currentStockBalance, stockShortfall 
      };
    } else {
      const workingDays = parseFloat(draft.workingDays || 0);
      const currentRecs = monthlyRecords[currentMonth] || {};
      let validReferralsCount = 0;
      (account.referralIds || []).forEach(refId => { const r = currentRecs[refId]; if (r && parseFloat(r.workingDays || 0) >= effectiveBizDays / 3) validReferralsCount++; });
      const finalHourly = (roleMaster[draft.role || account.role]?.base || 0) + validReferralsCount * 50;
      const attendanceAllowance = workingDays >= 20 ? 15000 : 0;
      const surplusCast = parseFloat(draft.surplusCast || 0), customAttendanceAllowance = parseFloat(draft.customAttendanceAllowance || 0);
      const totalHoursDecimal = parseFloat(draft.hours || 0) + parseFloat(draft.minutes || 0) / 60;
      let othersPlus = 0, othersMinus = 0;
      (draft.others || []).forEach(i => { const a = parseFloat(i.amount || 0); i.type === '+' ? othersPlus += a : othersMinus += a; });
      const basePayment = Math.floor(totalHoursDecimal * finalHourly);
      const totalPayment = basePayment + attendanceAllowance + surplusCast + customAttendanceAllowance + othersPlus;
      const withholdingTax = Math.floor(totalPayment * 0.1021);
      const dailyAdvance = parseFloat(draft.dailyAdvance || 0);
      const totalDeduction = withholdingTax + dailyAdvance + othersMinus;
      const netPayment = Math.max(0, totalPayment - totalDeduction);
      calc = { validReferralsCount, finalHourly, attendanceAllowance, basePayment, totalPayment, withholdingTax, totalDeduction, netPayment };
    }

    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className={`flex items-center justify-between px-5 py-4 ${isEmployee ? 'bg-blue-600' : 'bg-purple-600'}`}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-sm">{account.name.slice(0,1)}</div>
            <div>
              <p className="font-bold text-white text-base">{account.name}</p>
              <p className="text-white/70 text-xs">{account.type} · {fmtMonth(currentMonth)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {notify && <span className="text-white/90 text-xs bg-white/20 px-3 py-1 rounded-full">✓ 保存しました</span>}
            <button onClick={handleSave} className="px-4 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5">
              <Save size={13} /> 保存
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/30 text-white font-bold text-lg transition-colors">×</button>
          </div>
        </div>

        <div className="p-5">
          {isEmployee ? (
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Sec label="勤怠" />
              <div><label className={cLbl}>役職</label>
                <select value={draft.role || account.role} onChange={e => ch('role', e.target.value)} className={cInp}>
                  {Object.entries(roleMaster).filter(([,d]) => d.type === '社員').map(([k]) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div><label className={cLbl}>欠勤日数</label>
                <select value={draft.absence || 0} onChange={e => ch('absence', e.target.value)} className={cInp}>
                  {[...Array(effectiveBizDays + 1).keys()].map(i => <option key={i} value={i}>{i}日</option>)}
                </select>
              </div>
              <div><label className={cLbl}>出勤日数（自動）</label><input readOnly value={`${calc.attendanceDays}日`} className={cRO} /></div>
              <div><label className={cLbl}>有給日数</label>
                <select value={draft.paidLeave || 0} onChange={e => ch('paidLeave', e.target.value)} className={cInp}>
                  {[...Array(effectiveBizDays + 1).keys()].map(i => <option key={i} value={i}>{i}日</option>)}
                </select>
              </div>
              <div><label className={cLbl}>遅刻日数</label>
                <select value={draft.lateness || 0} onChange={e => ch('lateness', e.target.value)} className={cInp}>
                  {[...Array(effectiveBizDays + 1).keys()].map(i => <option key={i} value={i}>{i}日</option>)}
                </select>
              </div>
              <Sec label="支給" />
              <div><label className={cLbl}>基本給</label><input readOnly value={calc.roleBase.toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>役職手当（自動）</label><input readOnly value={calc.roleAllowance.toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>皆勤手当（自動）</label><input readOnly value={calc.perfectAttendance.toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>扶養手当</label><NumInput value={draft.depAllowance} onChange={v => ch('depAllowance', v)} className={cInp} /></div>
              
              {isEligibleForBonus && (
                <>
                  <div><label className={cLbl}>就社祝い金プラン ({bonusMonthStr})</label>
                    <select value={draft.bonusType || ''} onChange={e => ch('bonusType', e.target.value)} className={cInp}>
                      <option value="">なし</option>
                      <option value="5万×6ヶ月">5万×6ヶ月</option>
                      <option value="半年後に30万">半年後に30万</option>
                    </select>
                  </div>
                  <div><label className={cLbl}>祝金反映額</label><input readOnly value={calc.joinBonus.toLocaleString() + '円'} className={cRO} /></div>
                </>
              )}
              
              <div><label className={cLbl}>歩合割合 (%)</label><NumInput value={draft.commissionPct} onChange={v => ch('commissionPct', v)} className={cInp} /></div>
              <div><label className={cLbl}>歩合支給額</label><input readOnly value={calc.commissionAmount.toLocaleString() + '円'} className={cRO} /></div>
              <Sec label="控除" />

              {/* 寮費利用チェックボックス */}
              <div className="col-span-3 mb-1">
                <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer w-1/3">
                  <input type="checkbox" checked={draft.dormRentUse || false} onChange={e => ch('dormRentUse', e.target.checked)} className="accent-indigo-600 w-3.5 h-3.5" />
                  <span className="text-xs font-bold text-slate-800 flex-1">寮を利用している</span>
                  <span className="text-xs font-medium text-slate-500">{(calc.dormRent||0).toLocaleString()}円</span>
                </label>
              </div>

              {/* 寮費ストック管理パネル */}
              {draft.dormRentUse && (
                <div className="col-span-3 bg-teal-50 px-4 py-3 rounded-xl border border-teal-200 mt-1 mb-3">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-teal-800 tracking-wider">【寮費ストック（前払準備金）】</span>
                    <span className="text-[11px] font-bold text-teal-700 bg-teal-100 px-2.5 py-0.5 rounded-full">
                      目標: {(ms.dormStockTarget || settings.dormStockTarget || 0).toLocaleString()}円 / 
                      現在の残高: {calc.currentStockBalance.toLocaleString()}円 (完済まで: {calc.stockShortfall.toLocaleString()}円)
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 flex items-center gap-2">
                      <label className={cLbl + " !mb-0 w-32 text-teal-900"}>今月 追加徴収する額</label>
                      <NumInput value={draft.stockAddition} onChange={v => ch('stockAddition', v)} className={cInp + " flex-1 !border-teal-300 focus:!ring-teal-500"} placeholder="一括・分割の天引き額" />
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <label className={cLbl + " !mb-0 w-32 text-rose-900"}>今月 ストックから払う額</label>
                      <NumInput value={draft.stockUsage} onChange={v => ch('stockUsage', v)} className={cInp + " flex-1 !border-rose-300 focus:!ring-rose-500"} placeholder="寮費不足時に使用する額" />
                    </div>
                  </div>
                  <p className="text-[10px] text-teal-600 mt-2">※給与から天引きしてストックを貯める場合は「追加徴収」に、給与が足りずストックから寮費を補填する場合は「ストックから払う額」に入力してください。自動的に残高に反映されます。</p>
                </div>
              )}

              {[
                { key: 'healthInsUse', label: '健康保険', val: calc.healthIns },
                { key: 'nursingInsUse', label: '介護保険', val: calc.nursingIns },
                { key: 'pensionUse', label: '厚生年金', val: calc.pension },
                { key: 'empInsUse', label: '雇用保険', val: calc.empIns },
              ].map(({ key, label, val }) => (
                <label key={key} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={draft[key] || false} onChange={e => ch(key, e.target.checked)} className="accent-indigo-600 w-3.5 h-3.5" />
                  <span className="text-xs text-slate-700 flex-1">{label}</span>
                  <span className="text-xs font-medium text-slate-500">{(val||0).toLocaleString()}円</span>
                </label>
              ))}
              <div><label className={cLbl}>源泉徴収（自動）</label><input readOnly value={calc.withholdingTax.toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>欠勤控除（自動）</label><input readOnly value={calc.absenceDeduction.toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>子育て支援金</label><NumInput value={draft.childSupport} onChange={v => ch('childSupport', v)} className={cInp} /></div>
              <div><label className={cLbl}>保証金</label><NumInput value={draft.deposit} onChange={v => ch('deposit', v)} className={cInp} /></div>
              <div><label className={cLbl}>退去費用</label><NumInput value={draft.moveOutFee} onChange={v => ch('moveOutFee', v)} className={cInp} /></div>
              <div><label className={cLbl}>日払い</label><NumInput value={draft.dailyAdvance} onChange={v => ch('dailyAdvance', v)} className={cInp} /></div>
              <Sec label="その他" />
              <div className="col-span-3 space-y-2">
                {(draft.others || []).map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input type="text" value={item.name} onChange={e => handleCustomItemChange(index, 'name', e.target.value)} className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" placeholder="項目名" />
                    <select value={item.type} onChange={e => handleCustomItemChange(index, 'type', e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
                      <option value="+">支給(+)</option><option value="-">控除(-)</option>
                    </select>
                    <NumInput value={item.amount} onChange={v => handleCustomItemChange(index, 'amount', v)} className="w-28 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" placeholder="金額" />
                    <button onClick={(e) => removeCustomItem(e, index)} className="p-1 text-slate-300 hover:text-red-500 rounded-lg"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button onClick={addCustomItem} className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 text-xs font-medium py-0.5"><Plus size={13} /> 項目追加</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-4 gap-y-3">
              <Sec label="勤怠" />
              <div><label className={cLbl}>役職</label>
                <select value={draft.role || account.role} onChange={e => ch('role', e.target.value)} className={cInp}>
                  {Object.entries(roleMaster).filter(([,d]) => d.type === 'アルバイト').map(([k]) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div><label className={cLbl}>勤務日数</label><NumInput value={draft.workingDays} onChange={v => ch('workingDays', v)} className={cInp} /></div>
              <div><label className={cLbl}>勤務時間（時）</label><NumInput value={draft.hours} onChange={v => ch('hours', v)} className={cInp} /></div>
              <div><label className={cLbl}>勤務時間（分）</label>
                <select value={draft.minutes || 0} onChange={e => ch('minutes', e.target.value)} className={cInp}>
                  {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => <option key={m} value={m}>{m}分</option>)}
                </select>
              </div>
              <div><label className={cLbl}>有効紹介 / 反映時給</label><input readOnly value={`${calc.validReferralsCount}人 / ${(calc.finalHourly||0).toLocaleString()}円`} className={cRO} /></div>
              <Sec label="支給" />
              <div><label className={cLbl}>基本給（時給×時間）</label><input readOnly value={(calc.basePayment||0).toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>手当（20日以上）</label><input readOnly value={(calc.attendanceAllowance||0).toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>黒字キャスト手当</label><NumInput value={draft.surplusCast} onChange={v => ch('surplusCast', v)} className={cInp} /></div>
              <div><label className={cLbl}>出勤手当（自由）</label><NumInput value={draft.customAttendanceAllowance} onChange={v => ch('customAttendanceAllowance', v)} className={cInp} /></div>
              <Sec label="控除" />
              <div><label className={cLbl}>源泉徴収（自動）</label><input readOnly value={(calc.withholdingTax||0).toLocaleString() + '円'} className={cRO} /></div>
              <div><label className={cLbl}>日払い</label><NumInput value={draft.dailyAdvance} onChange={v => ch('dailyAdvance', v)} className={cInp} /></div>
              <Sec label="その他" />
              <div className="col-span-3 space-y-2">
                {(draft.others || []).map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input type="text" value={item.name} onChange={e => handleCustomItemChange(index, 'name', e.target.value)} className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" placeholder="項目名" />
                    <select value={item.type} onChange={e => handleCustomItemChange(index, 'type', e.target.value)} className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
                      <option value="+">支給(+)</option><option value="-">控除(-)</option>
                    </select>
                    <NumInput value={item.amount} onChange={v => handleCustomItemChange(index, 'amount', v)} className="w-28 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" placeholder="金額" />
                    <button onClick={(e) => removeCustomItem(e, index)} className="p-1 text-slate-300 hover:text-red-500 rounded-lg"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button onClick={addCustomItem} className="flex items-center gap-1 text-indigo-500 hover:text-indigo-700 text-xs font-medium py-0.5"><Plus size={13} /> 項目追加</button>
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-3 rounded-xl overflow-hidden border border-slate-100">
            <div className="p-4 bg-slate-50 text-center border-r border-slate-100">
              <p className="text-[10px] text-slate-400 mb-1">支給合計</p>
              <p className="text-lg font-bold text-slate-800">{(calc.totalPayment||0).toLocaleString()}<span className="text-xs font-normal ml-0.5">円</span></p>
            </div>
            <div className="p-4 bg-rose-50 text-center border-r border-slate-100">
              <p className="text-[10px] text-rose-400 mb-1">控除合計</p>
              <p className="text-lg font-bold text-rose-600">{(calc.totalDeduction||0).toLocaleString()}<span className="text-xs font-normal ml-0.5">円</span></p>
            </div>
            <div className={`p-4 text-center ${isEmployee ? 'bg-blue-600' : 'bg-purple-600'}`}>
              <p className="text-[10px] text-white/70 mb-1">差引支給額</p>
              <p className="text-xl font-extrabold text-white">{(calc.netPayment||0).toLocaleString()}<span className="text-xs font-normal ml-0.5">円</span></p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">閉じる</button>
            <button onClick={handleSave} className={`px-5 py-2 text-white rounded-xl text-sm font-semibold transition-colors shadow-sm flex items-center gap-2 ${isEmployee ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'}`}>
              <Save size={14} /> 保存
            </button>
          </div>
        </div>
      </div>
    );
  };


  // ═══════════════════════════════════════════════════════════
  // ④ 明細出力
  // ═══════════════════════════════════════════════════════════
  const SlipsScreen = () => {
    const [empType, setEmpType] = useState('社員');
    const [mode, setMode] = useState('all'); // 'all' | 'individual'
    const [selectedId, setSelectedId] = useState('');

    const ms = getMonthSettings(currentMonth);
    const effectiveSettings = { ...settings, ...ms };
    const currentRecords = monthlyRecords[currentMonth] || {};
    const filtered = accounts.filter(a => a.type === empType && currentRecords[a.id]);

    const getPast12Months = () => {
      const months = [];
      for (let i = 0; i < 12; i++) {
        const m = shiftMonth(currentMonth, -i);
        months.push(m);
      }
      return months;
    };

    const buildSlipData = (account, month) => {
      const ms2 = getMonthSettings(month);
      const eff = { ...settings, ...ms2 };
      const rec = (monthlyRecords[month] || {})[account.id];
      if (!rec) return null;

      let paymentDetails = [], deductionDetails = [];
      let totalPay = 0, totalDed = 0, net = 0;
      let workDays = 0, absence = 0, lateness = 0, paidLeave = 0, workHoursLabel = '';
      let currentStockBalance = 0; // 明細印字用

      if (account.type === '社員') {
        const roleBase = (ms2.baseSalary && ms2.baseSalary > 0) ? ms2.baseSalary : (roleMaster[rec.role || account.role]?.base || 0);
        absence = parseFloat(rec.absence || 0);
        paidLeave = parseFloat(rec.paidLeave || 0);
        lateness = parseFloat(rec.lateness || 0);
        workDays = (eff.businessDays || 25) - absence;
        const roleAllowance = ms2.roleAllowances?.[rec.role || account.role] || parseFloat(rec.roleAllowance || 0);
        
        const perfectAttendance = (absence + lateness) >= 1 ? 0 : 30000;
        const absenceDeduction = absence * 30000;
        
        const depAllowance = parseFloat(rec.depAllowance || 0);
        
        let joinBonus = 0;
        if (account.joinDate) {
          const joinDate = new Date(account.joinDate);
          const cmd = new Date(month + '-01');
          const md = (cmd.getFullYear() - joinDate.getFullYear()) * 12 + cmd.getMonth() - joinDate.getMonth();
          if (md >= 0 && md <= 5) {
            if (rec.bonusType === '5万×6ヶ月') joinBonus = 50000;
            else if (rec.bonusType === '半年後に30万' && md === 5) joinBonus = 300000;
          }
        }
        
        const commissionAmount = Math.floor((eff.totalCommission || 0) * (parseFloat(rec.commissionPct || 0) / 100));

        // ストック計算ロジック
        let pastStockAddition = 0;
        let pastStockUsage = 0;
        Object.keys(monthlyRecords).forEach(m => {
          if (m <= month && monthlyRecords[m][account.id]) { // 当月分まで合算
            pastStockAddition += parseFloat(monthlyRecords[m][account.id].stockAddition || 0);
            pastStockUsage += parseFloat(monthlyRecords[m][account.id].stockUsage || 0);
          }
        });
        currentStockBalance = pastStockAddition - pastStockUsage;
        const currentStockAddition = parseFloat(rec.stockAddition || 0);
        const currentStockUsage = parseFloat(rec.stockUsage || 0);

        paymentDetails.push({ label: '基本給', amount: roleBase });
        if (roleAllowance > 0) paymentDetails.push({ label: '役職手当', amount: roleAllowance });
        if (perfectAttendance > 0) paymentDetails.push({ label: '皆勤手当', amount: perfectAttendance });
        if (depAllowance > 0) paymentDetails.push({ label: '扶養手当', amount: depAllowance });
        if (joinBonus > 0) paymentDetails.push({ label: '就社祝い金', amount: joinBonus });
        if (commissionAmount > 0) paymentDetails.push({ label: '歩合', amount: commissionAmount });
        if (currentStockUsage > 0) paymentDetails.push({ label: '寮費ストック充当', amount: currentStockUsage }); // 補填分

        let othersPlus = 0, othersMinus = 0;
        (rec.others || []).forEach(item => {
          const amt = parseFloat(item.amount || 0);
          if (item.type === '+') { paymentDetails.push({ label: item.name, amount: amt }); othersPlus += amt; }
          else { deductionDetails.push({ label: item.name, amount: amt }); othersMinus += amt; }
        });
        totalPay = roleBase + roleAllowance + perfectAttendance + depAllowance + joinBonus + commissionAmount + currentStockUsage + othersPlus;
        
        const taxablePayment = totalPay - currentStockUsage;
        const healthIns = rec.healthInsUse ? Math.floor(taxablePayment * ((eff.healthInsRate || 0) / 100)) : 0;
        const withholdingTax = Math.floor((taxablePayment - healthIns) * 0.1021);
        const nursingIns = rec.nursingInsUse ? Math.floor(taxablePayment * ((eff.nursingInsRate || 0) / 100)) : 0;
        const pension = rec.pensionUse ? Math.floor(taxablePayment * ((eff.pensionRate || 0) / 100)) : 0;
        const empIns = rec.empInsUse ? Math.floor(taxablePayment * ((eff.empInsRate || 0) / 100)) : 0;
        const dormRent = rec.dormRentUse ? (eff.dormRent || 0) : 0;

        deductionDetails.push({ label: '所得税', amount: withholdingTax });
        if (absenceDeduction > 0) deductionDetails.push({ label: '欠勤控除', amount: absenceDeduction });
        if (healthIns > 0) deductionDetails.push({ label: '健康保険', amount: healthIns });
        if (nursingIns > 0) deductionDetails.push({ label: '介護保険', amount: nursingIns });
        if (pension > 0) deductionDetails.push({ label: '厚生年金', amount: pension });
        if (empIns > 0) deductionDetails.push({ label: '雇用保険', amount: empIns });
        if (dormRent > 0) deductionDetails.push({ label: '寮費', amount: dormRent });
        if (currentStockAddition > 0) deductionDetails.push({ label: '寮費ストック積立', amount: currentStockAddition });

        ['childSupport', 'deposit', 'moveOutFee', 'dailyAdvance'].forEach(k => {
          const v = parseFloat(rec[k] || 0);
          if (v > 0) deductionDetails.push({ label: { childSupport: '子育て支援金', deposit: '保証金', moveOutFee: '退去費用', dailyAdvance: '日払い' }[k], amount: v });
        });
        totalDed = deductionDetails.reduce((s, d) => s + d.amount, 0);
        net = Math.max(0, totalPay - totalDed);
        return { account, month, paymentDetails, deductionDetails, totalPay, totalDed, net, workDays, absence, lateness, paidLeave, workHoursLabel, currentStockBalance, dormRentUse: rec.dormRentUse };
      } else {
        workDays = parseFloat(rec.workingDays || 0);
        const hours = parseFloat(rec.hours || 0);
        const minutes = parseFloat(rec.minutes || 0);
        const totalHoursDecimal = hours + (minutes / 60);
        workHoursLabel = `${hours}時間 ${minutes}分`;
        let validReferralsCount = 0;
        (account.referralIds || []).forEach(refId => {
          const refRec = (monthlyRecords[month] || {})[refId];
          if (refRec && parseFloat(refRec.workingDays || 0) >= (eff.businessDays || 25) / 3) validReferralsCount++;
        });
        const finalHourly = (roleMaster[rec.role || account.role]?.base || 0) + validReferralsCount * 50;
        const attendanceAllowance = workDays >= 20 ? 15000 : 0;
        const surplusCast = parseFloat(rec.surplusCast || 0);
        const customAttendanceAllowance = parseFloat(rec.customAttendanceAllowance || 0);
        const basePayment = Math.floor(totalHoursDecimal * finalHourly);
        paymentDetails.push({ label: '基本給', amount: basePayment });
        if (attendanceAllowance > 0) paymentDetails.push({ label: '手当', amount: attendanceAllowance });
        if (surplusCast > 0) paymentDetails.push({ label: '黒字キャスト', amount: surplusCast });
        if (customAttendanceAllowance > 0) paymentDetails.push({ label: '出勤手当', amount: customAttendanceAllowance });
        let othersPlus = 0, othersMinus = 0;
        (rec.others || []).forEach(item => {
          const amt = parseFloat(item.amount || 0);
          if (item.type === '+') { paymentDetails.push({ label: item.name, amount: amt }); othersPlus += amt; }
          else { deductionDetails.push({ label: item.name, amount: amt }); othersMinus += amt; }
        });
        totalPay = basePayment + attendanceAllowance + surplusCast + customAttendanceAllowance + othersPlus;
        const withholdingTax = Math.floor(totalPay * 0.1021);
        const dailyAdvance = parseFloat(rec.dailyAdvance || 0);
        deductionDetails.push({ label: '所得税', amount: withholdingTax });
        if (dailyAdvance > 0) deductionDetails.push({ label: '日払い', amount: dailyAdvance });
        totalDed = deductionDetails.reduce((s, d) => s + d.amount, 0) + othersMinus;
        net = Math.max(0, totalPay - totalDed);
        return { account, month, paymentDetails, deductionDetails, totalPay, totalDed, net, workDays, absence, lateness, paidLeave, workHoursLabel, finalHourly, currentStockBalance: 0, dormRentUse: false };
      }
    };

    // A4縦で3人分入るように横長・高さ圧縮レイアウト
    const SlipCard = ({ data }) => {
      const { account, month, paymentDetails, deductionDetails, totalPay, totalDed, net, workDays, absence, lateness, paidLeave, workHoursLabel, finalHourly, currentStockBalance, dormRentUse } = data;
      return (
        <div className="slip-card bg-white py-4 px-2" style={{ width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="flex justify-between items-end mb-2">
            <div className="text-xl font-bold tracking-widest underline">給与支払明細書</div>
            <div className="flex gap-4 items-end">
              <div className="font-bold text-sm">{fmtMonth(month)}分</div>
              <div className="font-bold border-b border-black px-4 text-lg">{account.name} <span className="text-sm font-normal">殿</span></div>
            </div>
          </div>
          
          <div className="mb-2 text-sm flex justify-between bg-gray-50 p-2 border border-gray-200">
            <div className="flex gap-6">
              {account.type === '社員' ? (
                <><span>勤務: {workDays}日</span><span>欠勤: {absence}回</span><span>遅刻: {lateness}回</span><span>有給: {paidLeave}回</span></>
              ) : (
                <><span>時給: {(finalHourly || 0).toLocaleString()}円</span><span>日数: {workDays}日</span><span>時間: {workHoursLabel}</span></>
              )}
            </div>
            {dormRentUse && (
              <div className="font-bold text-teal-800">
                寮費ストック残高: {currentStockBalance.toLocaleString()} 円
              </div>
            )}
          </div>
          
          <div className="flex w-full border-2 border-black mb-2 flex-1">
            <div className="w-1/2 border-r-2 border-black flex flex-col">
              <div className="bg-gray-100 text-center font-bold py-1 border-b-2 border-black text-sm">支 給</div>
              <div className="p-2 flex-1 text-sm">
                {paymentDetails.map((item, i) => (
                  <div key={i} className="flex justify-between mb-1"><span>{item.label}</span><span>{item.amount.toLocaleString()}</span></div>
                ))}
              </div>
              <div className="flex justify-between p-2 border-t-2 border-black font-bold bg-gray-50 text-sm"><span>支給合計</span><span>{totalPay.toLocaleString()}</span></div>
            </div>
            <div className="w-1/2 flex flex-col">
              <div className="bg-gray-100 text-center font-bold py-1 border-b-2 border-black text-sm">差 引</div>
              <div className="p-2 flex-1 text-sm">
                {deductionDetails.map((item, i) => (
                  <div key={i} className="flex justify-between mb-1"><span>{item.label}</span><span>{item.amount.toLocaleString()}</span></div>
                ))}
              </div>
              <div className="flex justify-between p-2 border-t-2 border-black font-bold bg-gray-50 text-sm"><span>控除合計</span><span>{totalDed.toLocaleString()}</span></div>
            </div>
          </div>
          
          <div className="flex justify-end mt-1">
            <div className="flex items-center">
              <span className="font-bold mr-4 text-base">差引支給額</span>
              <div className="border-b-2 border-black px-6 py-1 font-bold text-xl min-w-[150px] text-right">
                {net.toLocaleString()} <span className="text-sm">円</span>
              </div>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="no-print bg-white rounded-2xl shadow-sm border border-slate-100 p-4 flex items-center gap-3 flex-wrap">
          {['社員', 'アルバイト'].map(t => (
            <button key={t} onClick={() => { setEmpType(t); setSelectedId(''); }}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${empType === t ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{t}</button>
          ))}
          <div className="w-px h-6 bg-slate-200 mx-1" />
          {[{ v: 'all', label: '全体明細出力' }, { v: 'individual', label: '個別明細出力' }].map(({ v, label }) => (
            <button key={v} onClick={() => { setMode(v); setSelectedId(''); }}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${mode === v ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>
          ))}
          <button onClick={() => window.print()} className="ml-auto px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-700 transition-colors flex items-center gap-2 shadow-sm">
            <Printer size={16} /> 印刷 / PDF出力
          </button>
        </div>

        {mode === 'all' && (
          <>
            <div className="no-print text-sm text-slate-500">{fmtMonth(currentMonth)} の {empType} {filtered.length}名分</div>
            {filtered.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-14 text-center text-slate-400">当月の{empType}データがありません</div>
            )}
            <div className="print-container">
              {filtered.map(account => {
                const data = buildSlipData(account, currentMonth);
                if (!data) return null;
                return <SlipCard key={account.id} data={data} />;
              })}
            </div>
          </>
        )}

        {mode === 'individual' && (
          <>
            <div className="no-print bg-white rounded-2xl shadow-sm border border-slate-100 p-4">
              <label className={lCls}>スタッフを選択</label>
              <select value={selectedId} onChange={e => setSelectedId(e.target.value)} className={`${iCls} max-w-xs`}>
                <option value="">— 選択してください —</option>
                {accounts.filter(a => a.type === empType).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {selectedId && (
              <div className="print-container">
                {getPast12Months().map(month => {
                  const account = accounts.find(a => a.id === selectedId);
                  if (!account) return null;
                  const data = buildSlipData(account, month);
                  if (!data) return null;
                  return (
                    <div key={month}>
                      <div className="no-print text-xs text-slate-400 mb-1 ml-1">{fmtMonth(month)}</div>
                      <SlipCard data={data} />
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // ⑤ 金種管理
  // ═══════════════════════════════════════════════════════════
  const CashScreen = () => {
    const currentRecords = monthlyRecords[currentMonth] || {};
    const ms = getMonthSettings(currentMonth);
    const eff = { ...settings, ...ms };

    const calcNet = (account) => {
      const rec = currentRecords[account.id];
      if (!rec) return 0;
      if (account.type === '社員') {
        const roleBase = (ms.baseSalary && ms.baseSalary > 0) ? ms.baseSalary : (roleMaster[rec.role || account.role]?.base || 0);
        const roleAllowance = ms.roleAllowances?.[rec.role || account.role] || parseFloat(rec.roleAllowance || 0);
        const absence = parseFloat(rec.absence || 0);
        const lateness = parseFloat(rec.lateness || 0);
        const perfectAttendance = (absence + lateness) >= 1 ? 0 : 30000;
        const absenceDeduction = absence * 30000;
        const depAllowance = parseFloat(rec.depAllowance || 0);
        let joinBonus = 0;
        if (account.joinDate) {
          const joinDate = new Date(account.joinDate);
          const cmd = new Date(currentMonth + '-01');
          const md = (cmd.getFullYear() - joinDate.getFullYear()) * 12 + cmd.getMonth() - joinDate.getMonth();
          if (md >= 0 && md <= 5) {
            if (rec.bonusType === '5万×6ヶ月') joinBonus = 50000;
            else if (rec.bonusType === '半年後に30万' && md === 5) joinBonus = 300000;
          }
        }
        const commissionAmount = Math.floor((eff.totalCommission || 0) * (parseFloat(rec.commissionPct || 0) / 100));
        let othersPlus = 0, othersMinus = 0;
        (rec.others || []).forEach(item => {
          const amt = parseFloat(item.amount || 0);
          if (item.type === '+') othersPlus += amt; else othersMinus += amt;
        });
        
        const currentStockUsage = parseFloat(rec.stockUsage || 0);
        const totalPay = roleBase + roleAllowance + perfectAttendance + depAllowance + joinBonus + commissionAmount + currentStockUsage + othersPlus;
        
        const taxablePay = totalPay - currentStockUsage;
        const healthIns = rec.healthInsUse ? Math.floor(taxablePay * ((eff.healthInsRate || 0) / 100)) : 0;
        const withholdingTax = Math.floor((taxablePay - healthIns) * 0.1021);
        const nursingIns = rec.nursingInsUse ? Math.floor(taxablePay * ((eff.nursingInsRate || 0) / 100)) : 0;
        const pension = rec.pensionUse ? Math.floor(taxablePay * ((eff.pensionRate || 0) / 100)) : 0;
        const empIns = rec.empInsUse ? Math.floor(taxablePay * ((eff.empInsRate || 0) / 100)) : 0;
        const dormRent = rec.dormRentUse ? (eff.dormRent || 0) : 0;
        const childSupport = parseFloat(rec.childSupport || 0);
        const deposit = parseFloat(rec.deposit || 0);
        const moveOutFee = parseFloat(rec.moveOutFee || 0);
        const dailyAdvance = parseFloat(rec.dailyAdvance || 0);
        const currentStockAddition = parseFloat(rec.stockAddition || 0);
        const totalDed = withholdingTax + healthIns + nursingIns + pension + empIns + dormRent + childSupport + deposit + moveOutFee + dailyAdvance + absenceDeduction + currentStockAddition + othersMinus;
        return Math.max(0, totalPay - totalDed);
      } else {
        const workingDays = parseFloat(rec.workingDays || 0);
        let validReferralsCount = 0;
        (account.referralIds || []).forEach(refId => {
          const refRec = currentRecords[refId];
          if (refRec && parseFloat(refRec.workingDays || 0) >= (eff.businessDays || 25) / 3) validReferralsCount++;
        });
        const finalHourly = (roleMaster[rec.role || account.role]?.base || 0) + validReferralsCount * 50;
        const attendanceAllowance = workingDays >= 20 ? 15000 : 0;
        const surplusCast = parseFloat(rec.surplusCast || 0);
        const customAttendanceAllowance = parseFloat(rec.customAttendanceAllowance || 0);
        const hours = parseFloat(rec.hours || 0);
        const minutes = parseFloat(rec.minutes || 0);
        const totalHoursDecimal = hours + (minutes / 60);
        let othersPlus = 0, othersMinus = 0;
        (rec.others || []).forEach(item => {
          const amt = parseFloat(item.amount || 0);
          if (item.type === '+') othersPlus += amt; else othersMinus += amt;
        });
        const totalPay = Math.floor(totalHoursDecimal * finalHourly) + attendanceAllowance + surplusCast + customAttendanceAllowance + othersPlus;
        const withholdingTax = Math.floor(totalPay * 0.1021);
        const dailyAdvance = parseFloat(rec.dailyAdvance || 0);
        const totalDed = withholdingTax + dailyAdvance + othersMinus;
        return Math.max(0, totalPay - totalDed);
      }
    };

    const staffWithPay = accounts
      .filter(a => currentRecords[a.id])
      .map(a => ({ account: a, net: calcNet(a) }));

    const grandTotal = staffWithPay.reduce((s, x) => s + x.net, 0);
    const breakdown = calcBreakdownByPerson(staffWithPay.map(x => x.net));

    return (
      <div className="space-y-4 max-w-2xl">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-center gap-6">
            <button onClick={() => setCurrentMonth(m => shiftMonth(m, -1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 text-xl font-bold transition-colors select-none"><ChevronLeft /></button>
            <span className="text-xl font-bold text-slate-800 min-w-[160px] text-center">{fmtMonth(currentMonth)}</span>
            <button onClick={() => setCurrentMonth(m => shiftMonth(m, 1))} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600 text-xl font-bold transition-colors select-none"><ChevronRight /></button>
          </div>
        </div>

        {(() => {
          const Note10000 = ({ w = 72, h = 36 }) => (
            <svg width={w} height={h} viewBox="0 0 72 36" style={{flexShrink:0,display:'block'}}>
              <rect width="72" height="36" rx="3" fill="#2d6e42"/>
              <rect x="2" y="2" width="68" height="32" rx="2" fill="none" stroke="#5aaa6a" strokeWidth="0.8" strokeDasharray="3 2"/>
              <ellipse cx="14" cy="18" rx="8" ry="11" fill="none" stroke="#5aaa6a" strokeWidth="0.6" opacity="0.7"/>
              <ellipse cx="14" cy="18" rx="5" ry="7" fill="none" stroke="#5aaa6a" strokeWidth="0.4" opacity="0.5"/>
              <circle cx="14" cy="18" r="2" fill="#5aaa6a" opacity="0.7"/>
              <ellipse cx="14" cy="11" rx="2.5" ry="3" fill="#5aaa6a" opacity="0.4"/>
              <ellipse cx="14" cy="25" rx="2.5" ry="3" fill="#5aaa6a" opacity="0.4"/>
              <ellipse cx="8"  cy="15" rx="3" ry="2" fill="#5aaa6a" opacity="0.4"/>
              <ellipse cx="20" cy="21" rx="3" ry="2" fill="#5aaa6a" opacity="0.4"/>
              <text x="42" y="13" textAnchor="middle" fontFamily="serif" fontSize="6" fill="#a0d8a8" fontWeight="bold">日本銀行券</text>
              <text x="42" y="26" textAnchor="middle" fontFamily="serif" fontSize="13" fill="#ffffff" fontWeight="bold">10000</text>
              <rect x="62" y="3" width="8" height="30" rx="1" fill="#1e4e2e" opacity="0.8"/>
            </svg>
          );
          const Note5000 = ({ w = 72, h = 36 }) => (
            <svg width={w} height={h} viewBox="0 0 72 36" style={{flexShrink:0,display:'block'}}>
              <rect width="72" height="36" rx="3" fill="#5a3878"/>
              <rect x="2" y="2" width="68" height="32" rx="2" fill="none" stroke="#a070c8" strokeWidth="0.8" strokeDasharray="3 2"/>
              <ellipse cx="14" cy="18" rx="8" ry="11" fill="none" stroke="#a070c8" strokeWidth="0.6" opacity="0.7"/>
              <ellipse cx="14" cy="18" rx="5" ry="7" fill="none" stroke="#a070c8" strokeWidth="0.4" opacity="0.5"/>
              <circle cx="14" cy="18" r="2" fill="#a070c8" opacity="0.7"/>
              <ellipse cx="14" cy="11" rx="2.5" ry="3" fill="#a070c8" opacity="0.4"/>
              <ellipse cx="14" cy="25" rx="2.5" ry="3" fill="#a070c8" opacity="0.4"/>
              <ellipse cx="8"  cy="15" rx="3" ry="2" fill="#a070c8" opacity="0.4"/>
              <ellipse cx="20" cy="21" rx="3" ry="2" fill="#a070c8" opacity="0.4"/>
              <text x="42" y="13" textAnchor="middle" fontFamily="serif" fontSize="6" fill="#c8a8e8" fontWeight="bold">日本銀行券</text>
              <text x="42" y="26" textAnchor="middle" fontFamily="serif" fontSize="13" fill="#ffffff" fontWeight="bold">5000</text>
              <rect x="62" y="3" width="8" height="30" rx="1" fill="#3a2058" opacity="0.8"/>
            </svg>
          );
          const Note1000 = ({ w = 72, h = 36 }) => (
            <svg width={w} height={h} viewBox="0 0 72 36" style={{flexShrink:0,display:'block'}}>
              <rect width="72" height="36" rx="3" fill="#1e4e88"/>
              <rect x="2" y="2" width="68" height="32" rx="2" fill="none" stroke="#60a0d8" strokeWidth="0.8" strokeDasharray="3 2"/>
              <ellipse cx="14" cy="18" rx="8" ry="11" fill="none" stroke="#60a0d8" strokeWidth="0.6" opacity="0.7"/>
              <ellipse cx="14" cy="18" rx="5" ry="7" fill="none" stroke="#60a0d8" strokeWidth="0.4" opacity="0.5"/>
              <circle cx="14" cy="18" r="2" fill="#60a0d8" opacity="0.7"/>
              <ellipse cx="14" cy="11" rx="2.5" ry="3" fill="#60a0d8" opacity="0.4"/>
              <ellipse cx="14" cy="25" rx="2.5" ry="3" fill="#60a0d8" opacity="0.4"/>
              <ellipse cx="8"  cy="15" rx="3" ry="2" fill="#60a0d8" opacity="0.4"/>
              <ellipse cx="20" cy="21" rx="3" ry="2" fill="#60a0d8" opacity="0.4"/>
              <text x="42" y="13" textAnchor="middle" fontFamily="serif" fontSize="6" fill="#a0c8f0" fontWeight="bold">日本銀行券</text>
              <text x="42" y="26" textAnchor="middle" fontFamily="serif" fontSize="13" fill="#ffffff" fontWeight="bold">1000</text>
              <rect x="62" y="3" width="8" height="30" rx="1" fill="#0e2e58" opacity="0.8"/>
            </svg>
          );
          const Coin500 = ({ r = 18 }) => {
            const s = r * 2 + 4;
            return (
              <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{flexShrink:0,display:'block'}}>
                <circle cx={s/2} cy={s/2} r={r} fill="#c8a030" stroke="#a08020" strokeWidth="1.5"/>
                <circle cx={s/2} cy={s/2} r={r-4} fill="none" stroke="#e8c848" strokeWidth="0.8"/>
                <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="#e8c848" strokeWidth="1.5" strokeDasharray="2.5 2"/>
                <circle cx={s/2} cy={s/2} r="3" fill="#a08020"/>
                <text x={s/2} y={s/2-3} textAnchor="middle" fontFamily="serif" fontSize="5" fill="#5a3800" fontWeight="bold">五百円</text>
                <text x={s/2} y={s/2+6} textAnchor="middle" fontFamily="serif" fontSize="9" fill="#fff8e0" fontWeight="bold">500</text>
              </svg>
            );
          };
          const Coin100 = ({ r = 16 }) => {
            const s = r * 2 + 4;
            return (
              <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{flexShrink:0,display:'block'}}>
                <circle cx={s/2} cy={s/2} r={r} fill="#b0b8c8" stroke="#8890a8" strokeWidth="1.5"/>
                <circle cx={s/2} cy={s/2} r={r-4} fill="none" stroke="#d0d8e8" strokeWidth="0.8"/>
                <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="#d0d8e8" strokeWidth="1.5" strokeDasharray="2.5 2"/>
                <circle cx={s/2} cy={s/2} r="2.5" fill="#8890a8"/>
                <text x={s/2} y={s/2-2} textAnchor="middle" fontFamily="serif" fontSize="5" fill="#303848" fontWeight="bold">百円</text>
                <text x={s/2} y={s/2+7} textAnchor="middle" fontFamily="serif" fontSize="9" fill="#ffffff" fontWeight="bold">100</text>
              </svg>
            );
          };
          const Coin50 = ({ r = 15 }) => {
            const s = r * 2 + 4;
            return (
              <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{flexShrink:0,display:'block'}}>
                <circle cx={s/2} cy={s/2} r={r} fill="#a8b0c0" stroke="#8890a8" strokeWidth="1.5"/>
                <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="#c8d0e0" strokeWidth="1.5" strokeDasharray="2.5 2"/>
                <circle cx={s/2} cy={s/2} r="4" fill="white"/>
                <text x={s/2} y={s/2-5} textAnchor="middle" fontFamily="serif" fontSize="5" fill="#303848" fontWeight="bold">五十円</text>
                <text x={s/2} y={s/2+8} textAnchor="middle" fontFamily="serif" fontSize="9" fill="#ffffff" fontWeight="bold">50</text>
              </svg>
            );
          };
          const Coin10 = ({ r = 14 }) => {
            const s = r * 2 + 4;
            return (
              <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{flexShrink:0,display:'block'}}>
                <circle cx={s/2} cy={s/2} r={r} fill="#b07838" stroke="#886028" strokeWidth="1.5"/>
                <circle cx={s/2} cy={s/2} r={r-4} fill="none" stroke="#d8a060" strokeWidth="0.8"/>
                <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="#d8a060" strokeWidth="1.5" strokeDasharray="2.5 2"/>
                <circle cx={s/2} cy={s/2} r="2.5" fill="#886028"/>
                <text x={s/2} y={s/2-2} textAnchor="middle" fontFamily="serif" fontSize="5" fill="#3a1800" fontWeight="bold">十円</text>
                <text x={s/2} y={s/2+7} textAnchor="middle" fontFamily="serif" fontSize="9" fill="#fff0d8" fontWeight="bold">10</text>
              </svg>
            );
          };
          const Coin5 = ({ r = 13 }) => {
            const s = r * 2 + 4;
            return (
              <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{flexShrink:0,display:'block'}}>
                <circle cx={s/2} cy={s/2} r={r} fill="#c09828" stroke="#987818" strokeWidth="1.5"/>
                <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="#e0c040" strokeWidth="1.5" strokeDasharray="2.5 2"/>
                <circle cx={s/2} cy={s/2} r="3.5" fill="white"/>
                <text x={s/2} y={s/2-4} textAnchor="middle" fontFamily="serif" fontSize="5" fill="#3a2800" fontWeight="bold">五円</text>
                <text x={s/2} y={s/2+7} textAnchor="middle" fontFamily="serif" fontSize="9" fill="#fff8d0" fontWeight="bold">5</text>
              </svg>
            );
          };
          const Coin1 = ({ r = 12 }) => {
            const s = r * 2 + 4;
            return (
              <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{flexShrink:0,display:'block'}}>
                <circle cx={s/2} cy={s/2} r={r} fill="#d8dce0" stroke="#b0b4b8" strokeWidth="1.5"/>
                <circle cx={s/2} cy={s/2} r={r-4} fill="none" stroke="#e8ecf0" strokeWidth="0.8"/>
                <circle cx={s/2} cy={s/2} r="2" fill="#b0b4b8"/>
                <text x={s/2} y={s/2-2} textAnchor="middle" fontFamily="serif" fontSize="5" fill="#404448" fontWeight="bold">一円</text>
                <text x={s/2} y={s/2+7} textAnchor="middle" fontFamily="serif" fontSize="9" fill="#404448" fontWeight="bold">1</text>
              </svg>
            );
          };

          const DENOM_ICONS_SM = {
            10000: <Note10000 w={56} h={28} />,
            5000:  <Note5000  w={56} h={28} />,
            1000:  <Note1000  w={56} h={28} />,
            500:   <Coin500  r={14} />,
            100:   <Coin100  r={13} />,
            50:    <Coin50   r={12} />,
            10:    <Coin10   r={11} />,
            5:     <Coin5    r={10} />,
            1:     <Coin1    r={9}  />,
          };
          const DENOM_ICONS_LG = {
            10000: <Note10000 w={80} h={40} />,
            5000:  <Note5000  w={80} h={40} />,
            1000:  <Note1000  w={80} h={40} />,
            500:   <Coin500  r={22} />,
            100:   <Coin100  r={20} />,
            50:    <Coin50   r={19} />,
            10:    <Coin10   r={18} />,
            5:     <Coin5    r={17} />,
            1:     <Coin1    r={16} />,
          };

          const PersonRow = ({ account, net }) => {
            const counts = breakdownSingle(net);
            const nonZero = counts.map((c, i) => ({ ...DENOMINATIONS[i], count: c })).filter(d => d.count > 0);
            const isEmp = account.type === '社員';
            return (
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <div className={`flex items-center justify-between px-4 py-3 ${isEmp ? 'bg-blue-50' : 'bg-purple-50'}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${isEmp ? 'bg-blue-200 text-blue-800' : 'bg-purple-200 text-purple-800'}`}>
                      {account.name.slice(0, 1)}
                    </div>
                    <span className="text-sm font-bold text-slate-800">{account.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${isEmp ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{account.type}</span>
                  </div>
                  <span className={`text-base font-extrabold ${isEmp ? 'text-blue-700' : 'text-purple-700'}`}>{net.toLocaleString()} 円</span>
                </div>
                <div className="px-4 py-3 bg-white flex flex-wrap gap-2 items-center">
                  {nonZero.length === 0 && <span className="text-xs text-slate-300">—</span>}
                  {nonZero.map((d, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5">
                      {DENOM_ICONS_SM[d.value]}
                      <span className="text-sm font-bold text-slate-700">×{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          };

          return (
            <>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h2 className="text-sm font-bold text-slate-800 mb-4">個人別 差引支給額 ＆ 必要金種</h2>
                {staffWithPay.length === 0 && <p className="text-slate-400 text-sm text-center py-8">当月のデータがありません</p>}
                <div className="space-y-3">
                  {staffWithPay.map(({ account, net }) => (
                    <PersonRow key={account.id} account={account} net={net} />
                  ))}
                </div>
                <div className="mt-4 flex justify-between items-center px-4 py-3 rounded-xl bg-indigo-50 border border-indigo-100">
                  <span className="text-sm font-bold text-indigo-700">合計支払額</span>
                  <span className="text-xl font-extrabold text-indigo-700">{grandTotal.toLocaleString()} 円</span>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                <h2 className="text-sm font-bold text-slate-800 mb-1">全員分 合計金種内訳</h2>
                <p className="text-xs text-slate-400 mb-4">※ 1人ずつ個別に両替した枚数の合計です</p>
                <div className="grid grid-cols-3 gap-3">
                  {breakdown.map((d, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${d.count > 0 ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100 opacity-40'}`}>
                      {DENOM_ICONS_LG[d.value]}
                      <div>
                        <div className={`text-2xl font-extrabold leading-none ${d.count > 0 ? 'text-slate-800' : 'text-slate-300'}`}>{d.count}<span className="text-xs font-semibold ml-0.5 text-slate-500">枚</span></div>
                        <div className="text-xs text-slate-400 mt-0.5">{d.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          );
        })()}
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════
  // レイアウト
  // ═══════════════════════════════════════════════════════════
  return (
    <>
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          body {
            margin: 0;
          }
          .no-print {
            display: none !important;
          }
          .print-container {
            display: block !important;
          }
          .slip-card {
            height: 33.3vh;
            page-break-inside: avoid;
            border: none !important;
            border-bottom: 1px dashed #ccc !important;
          }
        }
      `}</style>
      <div className="min-h-screen bg-slate-100 flex">
        {/* Sidebar */}
        <aside className="no-print fixed left-0 top-0 h-full w-56 bg-slate-900 flex flex-col z-20">
          <div className="px-5 py-5 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/40 flex-shrink-0">
                <span className="text-white font-black text-base">¥</span>
              </div>
              <div>
                <div className="text-white font-bold text-sm leading-tight">給与管理</div>
                <div className="text-slate-500 text-xs">Salary System</div>
              </div>
            </div>
          </div>

          <div className="mx-3 mt-4 px-3 py-2.5 bg-slate-800 rounded-xl">
            <p className="text-slate-500 text-xs mb-1">対象月</p>
            <div className="flex items-center justify-between gap-1">
              <button onClick={() => setCurrentMonth(m => shiftMonth(m, -1))} className="text-slate-400 hover:text-white font-bold text-base leading-none select-none">＜</button>
              <p className="text-white font-semibold text-sm text-center">{fmtMonth(currentMonth)}</p>
              <button onClick={() => setCurrentMonth(m => shiftMonth(m, 1))} className="text-slate-400 hover:text-white font-bold text-base leading-none select-none">＞</button>
            </div>
          </div>

          <nav className="flex-1 px-3 mt-3 space-y-0.5">
            {navItems.map(({ tab, icon: Icon, label }) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${activeTab === tab ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>
                <Icon size={17} />
                {label}
              </button>
            ))}
          </nav>

          <div className="px-4 py-4 border-t border-slate-800">
            <p className="text-xs text-slate-600 text-center">v2.0</p>
          </div>
        </aside>

        <div className="ml-56 flex-1 flex flex-col min-h-screen">
          <header className="no-print bg-white border-b border-slate-200 px-8 py-4 flex items-center gap-3 shadow-sm">
            <div>
              <h1 className="text-base font-bold text-slate-800">{pageTitles[activeTab]}</h1>
              <p className="text-xs text-slate-400">{fmtMonth(currentMonth)}分</p>
            </div>
          </header>

          <main className="flex-1 p-8">
            {activeTab === 'settings' && <SettingsScreen />}
            {activeTab === 'accounts' && <AccountsScreen />}
            {activeTab === 'allowances' && <AllowancesScreen />}
            {activeTab === 'input' && <InputScreen />}
            {activeTab === 'slips' && <SlipsScreen />}
            {activeTab === 'cash' && <CashScreen />}
          </main>
        </div>
      </div>
    </>
  );
}