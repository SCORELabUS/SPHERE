import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import DatePicker from '../../../core/components/date-picker';

const axisTick = { fill: '#4a4a4a', fontSize: 11 };
const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmtY = (v: number) => { if (!Number.isFinite(v)) return ''; return Math.abs(v) >= 1000 ? compactNum.format(v) : String(v); };
const fmtTooltip = (v: number) => Number.isFinite(v) ? Number(v.toFixed(2)).toString() : String(v);

interface ChartEntry {
  date: string;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  configs: number;
  plans: number;
  features: number;
  addOns: number;
  usageLimits: number;
}

interface PricingAnalyticsTabProps {
  chartData: ChartEntry[];
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
}

export default function PricingAnalyticsTab({
  chartData,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}: PricingAnalyticsTabProps) {
  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-tp-hairline-soft bg-tp-canvas py-16 text-center">
        <p className="text-sm text-tp-steel">No data available for the selected date range.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-medium text-tp-ink">Analytics</h3>
        <DatePicker dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={onDateFromChange} onDateToChange={onDateToChange} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
          <div className="mb-3 flex items-center justify-center gap-4 text-[11px]">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-[#2563eb]" />Min price</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-[#dc2626]" />Max price</span>
          </div>
          <ResponsiveContainer width="100%" height={220}><LineChart data={chartData} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#ededed" /><XAxis dataKey="date" tick={axisTick} /><YAxis tick={axisTick} tickFormatter={fmtY} width={50} domain={['auto', 'auto']} /><Tooltip formatter={(v: number) => fmtTooltip(v)} isAnimationActive={false} /><Line type="monotone" dataKey="minPrice" name="Min" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} /><Line type="monotone" dataKey="maxPrice" name="Max" stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer>
        </div>
        {([['configs', 'Configuration Space', '#08aeb3', 'configs'], ['plans', 'Plans', '#7c3aed', 'plans'], ['features', 'Features', '#0891b2', 'features'], ['addOns', 'Add-Ons', '#16a34a', 'addOns'], ['usageLimits', 'Usage Limits', '#ea580c', 'usageLimits']] as const).map(([k, label, color, dk]) => (
          <div key={k} className="rounded-xl border border-tp-hairline-soft bg-tp-canvas p-4">
            <div className="mb-2 flex items-center justify-center gap-2 text-[11px] text-tp-ink"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />{label}</div>
            <ResponsiveContainer width="100%" height={220}><LineChart data={chartData} margin={{ top: 5, right: 10, left: -8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#ededed" /><XAxis dataKey="date" tick={axisTick} /><YAxis tick={axisTick} tickFormatter={fmtY} width={50} domain={['auto', 'auto']} /><Tooltip formatter={(v: number) => fmtTooltip(v)} isAnimationActive={false} /><Line type="monotone" dataKey={dk} stroke={color} strokeWidth={2} dot={{ r: 2 }} /></LineChart></ResponsiveContainer>
          </div>
        ))}
      </div>
    </>
  );
}
