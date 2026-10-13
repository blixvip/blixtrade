import { Icon } from '@/shell/icons';
import '@/styles/launch-plans.css';

export type LaunchPlanKey = 'cheap' | 'back' | 'custom';
type Option = { key: LaunchPlanKey; total: number; hold: number; buy: number };
const copy = {
  cheap: { title: 'Low-cost launch', tag: 'NO FIRST BUY', description: 'Create your coin with the lowest priority fee.', action: 'Use low-cost plan', icon: Icon.coins },
  back: { title: 'Back your coin', tag: 'BUY AT LAUNCH', description: 'Buy 0.25 SOL of your coin as it launches.', action: 'Use first-buy plan', icon: Icon.wallets },
  custom: { title: 'Your own setup', tag: 'FULL CONTROL', description: 'Set your first buy and priority fee below.', action: 'Customise settings', icon: Icon.settings },
};
export function LaunchPlans({ selected, options, solUsd, onSelect }: { selected: LaunchPlanKey; options: Option[]; solUsd: number; onSelect: (key: LaunchPlanKey) => void }) {
  return <section className="launch-plans" aria-labelledby="launch-plans-title">
    <header className="launch-plans-heading"><div><h2 id="launch-plans-title">How do you want to launch?</h2><p>Choose a starting point. You can adjust the details below.</p></div><span className="launch-estimate">Estimated one-time cost</span></header>
    <div className="launch-plan-grid" role="radiogroup" aria-label="Launch plan">
      {options.map((option, index) => {
        const text = copy[option.key], active = selected === option.key, Mark = text.icon;
        return <button key={option.key} type="button" role="radio" aria-checked={active} tabIndex={active ? 0 : -1} className="launch-plan-card" onClick={() => onSelect(option.key)}
          onKeyDown={event => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length; onSelect(options[next].key); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); }}>
          <span className="launch-plan-top"><span className="launch-plan-icon"><Mark className="size-4" /></span><span className="launch-plan-tag">{text.tag}</span><span className="launch-plan-radio">{active && <svg viewBox="0 0 16 16" fill="none" aria-hidden><path d="m4 8 3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}</span></span>
          <strong className="launch-plan-title">{text.title}</strong>
          <span className="launch-plan-price"><b>{option.total.toFixed(4)}</b><span>SOL</span></span>
          <span className="launch-plan-dollar">{solUsd ? `≈ ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(option.total * solUsd)}` : 'USD estimate unavailable'}</span>
          <span className="launch-plan-description">{text.description}</span>
          <span className="launch-plan-facts"><span>First buy <b>{option.buy ? `${option.buy} SOL` : 'None'}</b></span><span>Your token share <b>{option.hold ? `${option.hold.toFixed(2)}%` : '0%'}</b></span></span>
          <span className="launch-plan-action">{active ? 'Selected' : text.action}<span aria-hidden>{active ? '✓' : '→'}</span></span>
        </button>;
      })}
    </div>
    <p className="launch-plan-note"><Icon.wallets className="size-3.5"/><span>Creator fees go to your Blix wallet on every plan. Manage auto-claim in <b>Creator rewards</b>.</span></p>
  </section>;
}
