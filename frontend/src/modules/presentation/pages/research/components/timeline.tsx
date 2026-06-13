import { motion, type Variants } from 'framer-motion';
import { type ReactNode } from 'react';
import { FaStar, FaTrophy } from 'react-icons/fa';

export interface TimelineItem {
  date: string;
  title: string;
  subtitle: string;
  text: string[];
  icon: ReactNode;
  href: string;
  variant: 'journal' | 'proceedings' | 'demo';
  awards?: string[];
}

const variantColors: Record<TimelineItem['variant'], string> = {
  journal: '#cc3a05',
  proceedings: '#fa520f',
  demo: '#ff8105',
};

const cardVariants: Variants = {
  hiddenLeft: { opacity: 0, x: -50, filter: 'blur(4px)' },
  hiddenRight: { opacity: 0, x: 50, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    x: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

const iconVariants: Variants = {
  hidden: { scale: 0, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring', stiffness: 300, damping: 22, delay: 0.2 },
  },
};

const dateVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, delay: 0.35 },
  },
};

function AwardBadge() {
  return (
    <div className="absolute -right-3 -top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border-2 border-tp-primary bg-tp-primary shadow-[0_2px_8px_rgba(250,82,15,0.35)]">
      <FaTrophy className="h-4 w-4 text-white" />
    </div>
  );
}

function CardContent({ item }: { item: TimelineItem }) {
  return (
    <>
      <a href={item.href} target="_blank" rel="noopener noreferrer" className="cursor-pointer">
        <h3 className="text-base font-bold leading-snug text-tp-ink underline decoration-tp-primary/30 underline-offset-2 transition-colors hover:text-tp-primary md:text-lg">
          {item.title}
        </h3>
      </a>
      <p className="mt-2 text-xs leading-relaxed text-tp-ink/60 md:text-sm">{item.subtitle}</p>
      <div className="mt-2.5 space-y-0.5">
        {item.text.map((line, i) => (
          <p key={i} className="text-xs text-tp-slate md:text-sm">
            {line}
          </p>
        ))}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DESKTOP CARD (alternating left / right)
   ═══════════════════════════════════════════════════════════════ */
function DesktopTimelineCard({ item, side }: { item: TimelineItem; side: 'left' | 'right' }) {
  const isLeft = side === 'left';

  return (
    <div className="relative grid grid-cols-[1fr_64px_1fr] items-center">
      {/* ── Left column ── */}
      {isLeft ? (
        <div className="col-start-1 flex justify-end">
          <motion.div
            variants={cardVariants}
            initial="hiddenLeft"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            className="relative w-full max-w-125"
          >
            {item.awards && item.awards.length > 0 && <AwardBadge />}
            <div className="rounded-2xl border border-tp-hairline-strong bg-white p-5 shadow-elevation-2 transition-all duration-300 hover:border-tp-primary/40 hover:shadow-elevation-3">
              <CardContent item={item} />
              {item.awards && item.awards.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.awards.map((award, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full bg-tp-primary/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-tp-primary"
                    >
                      <FaTrophy className="h-2.5 w-2.5" />
                      {award}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Arrow */}
            <div
              className="absolute top-1/2 right-0 hidden -translate-y-1/2 translate-x-2.25 md:block"
              style={{ width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: '9px solid #e5e5e5' }}
            />
            <div
              className="absolute top-1/2 right-0 hidden -translate-y-1/2 translate-x-2.5 md:block"
              style={{ width: 0, height: 0, borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderLeft: '8px solid white' }}
            />
          </motion.div>
        </div>
      ) : (
        /* Date on the left for right-side cards */
        <div className="col-start-1 flex justify-end pr-6">
          <motion.span
            variants={dateVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="self-center whitespace-nowrap text-sm font-semibold text-tp-ink"
          >
            {item.date}
          </motion.span>
        </div>
      )}

      {/* ── Center column: icon ── */}
      <div className="col-start-2 flex justify-center">
        <motion.div
          variants={iconVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white shadow-[0_0_0_3px_var(--color-tp-primary)] md:h-12 md:w-12"
          style={{ backgroundColor: variantColors[item.variant] }}
        >
          {item.icon}
        </motion.div>
      </div>

      {/* ── Right column ── */}
      {!isLeft ? (
        <div className="col-start-3 flex justify-start">
          <motion.div
            variants={cardVariants}
            initial="hiddenRight"
            whileInView="visible"
            viewport={{ once: true, amount: 0.3 }}
            className="relative w-full max-w-125"
          >
            {item.awards && item.awards.length > 0 && <AwardBadge />}
            <div className="rounded-2xl border border-tp-hairline-strong bg-white p-5 shadow-elevation-2 transition-all duration-300 hover:border-tp-primary/40 hover:shadow-elevation-3">
              <CardContent item={item} />
              {item.awards && item.awards.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.awards.map((award, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full bg-tp-primary/8 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-tp-primary"
                    >
                      <FaTrophy className="h-2.5 w-2.5" />
                      {award}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Arrow */}
            <div
              className="absolute top-1/2 left-0 hidden -translate-y-1/2 -translate-x-2.25 md:block"
              style={{ width: 0, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderRight: '9px solid #e5e5e5' }}
            />
            <div
              className="absolute top-1/2 left-0 hidden -translate-y-1/2 -translate-x-2.5 md:block"
              style={{ width: 0, height: 0, borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderRight: '8px solid white' }}
            />
          </motion.div>
        </div>
      ) : (
        /* Date on the right for left-side cards */
        <div className="col-start-3 flex justify-start pl-6">
          <motion.span
            variants={dateVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="self-center whitespace-nowrap text-sm font-semibold text-tp-ink"
          >
            {item.date}
          </motion.span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MOBILE CARD (single column, line on left)
   ═══════════════════════════════════════════════════════════════ */
function MobileTimelineCard({ item }: { item: TimelineItem }) {
  return (
    <div className="relative grid grid-cols-[40px_1fr] items-start gap-3">
      {/* Icon */}
      <div className="flex justify-center pt-1">
        <motion.div
          variants={iconVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white shadow-[0_0_0_2.5px_var(--color-tp-primary)]"
          style={{ backgroundColor: variantColors[item.variant] }}
        >
          {item.icon}
        </motion.div>
      </div>

      {/* Card */}
      <motion.div
        variants={cardVariants}
        initial="hiddenRight"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        className="relative w-full pb-2"
      >
        {item.awards && item.awards.length > 0 && (
          <div className="absolute -right-2 -top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 border-tp-primary bg-tp-primary shadow-[0_2px_8px_rgba(250,82,15,0.35)]">
            <FaTrophy className="h-3 w-3 text-white" />
          </div>
        )}
        <div className="rounded-xl border border-tp-hairline-strong bg-white p-4 shadow-elevation-1">
          <span className="mb-2 block text-[10px] font-semibold text-tp-stone">{item.date}</span>
          <CardContent item={item} />
          {item.awards && item.awards.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1">
              {item.awards.map((award, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-tp-primary/8 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-tp-primary"
                >
                  <FaTrophy className="h-2 w-2" />
                  {award}
                </span>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TIMELINE (exported)
   ═══════════════════════════════════════════════════════════════ */
export default function Timeline({ items }: { items: TimelineItem[] }) {
  const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="relative w-full">
      {/* ═══ Desktop ═══ */}
      <div className="hidden md:block">
        {/* Vertical line — behind icons */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-tp-hairline-strong" />
        <div className="absolute left-1/2 top-0 bottom-0 w-0.75 -translate-x-1/2 rounded-full bg-linear-to-b from-tp-primary via-tp-primary to-tp-primary/20" />

        <div className="space-y-14">
          {sorted.map((item, index) => (
            <DesktopTimelineCard key={index} item={item} side={index % 2 === 0 ? 'left' : 'right'} />
          ))}
        </div>

        {/* End cap */}
        <div className="relative mt-14 flex justify-center">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-tp-primary shadow-[0_0_0_3px_var(--color-tp-primary),0_4px_12px_rgba(250,82,15,0.3)]"
          >
            <FaStar className="h-5 w-5 text-white" />
          </motion.div>
        </div>
      </div>

      {/* ═══ Mobile ═══ */}
      <div className="md:hidden">
        {/* Vertical line */}
        <div className="absolute left-4.75 top-0 bottom-0 w-0.75 rounded-full bg-linear-to-b from-tp-primary via-tp-primary to-tp-primary/20" />

        <div className="space-y-6">
          {sorted.map((item, index) => (
            <MobileTimelineCard key={index} item={item} />
          ))}
        </div>

        {/* End cap */}
        <div className="relative mt-6 flex justify-start pl-1.5">
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-white bg-tp-primary shadow-[0_0_0_2.5px_var(--color-tp-primary),0_4px_12px_rgba(250,82,15,0.3)]"
          >
            <FaTrophy className="h-4 w-4 text-white" />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
