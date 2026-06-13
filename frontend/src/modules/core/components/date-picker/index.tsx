import { useState, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isAfter,
  isBefore,
  isToday,
} from 'date-fns';
import { dropdownVariants, transitionFast } from '../../utils/motion-variants';

interface DatePickerProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (date: string) => void;
  onDateToChange: (date: string) => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function DatePicker({ dateFrom, dateTo, onDateFromChange, onDateToChange }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [selectingEnd, setSelectingEnd] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const startDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
  const endDate = dateTo ? new Date(dateTo + 'T00:00:00') : null;

  const [viewMonth, setViewMonth] = useState(() => startDate ?? new Date());

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart);
    const calEnd = endOfWeek(monthEnd);
    return eachDayOfInterval({ start: calStart, end: calEnd });
  }, [viewMonth]);

  const hasRange = startDate && endDate;
  const displayLabel = hasRange
    ? `${format(startDate, 'MMM d, yyyy')} – ${format(endDate, 'MMM d, yyyy')}`
    : startDate
      ? format(startDate, 'MMM d, yyyy')
      : 'Select dates';

  const handleDayClick = (day: Date) => {
    const dayStr = format(day, 'yyyy-MM-dd');
    if (!selectingEnd || !startDate) {
      onDateFromChange(dayStr);
      onDateToChange('');
      setSelectingEnd(true);
    } else {
      if (isBefore(day, startDate)) {
        onDateFromChange(dayStr);
        onDateToChange('');
      } else {
        onDateToChange(dayStr);
        setSelectingEnd(false);
      }
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDateFromChange('');
    onDateToChange('');
    setSelectingEnd(false);
    setHoverDate(null);
  };

  const effectiveEnd = selectingEnd && startDate && hoverDate && isAfter(hoverDate, startDate) ? hoverDate : endDate;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => { setIsOpen(prev => !prev); setSelectingEnd(!!startDate && !endDate); }}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${
          hasRange
            ? 'border-tp-primary/30 bg-tp-primary/5 text-tp-primary'
            : 'border-tp-hairline-strong bg-tp-canvas text-tp-slate hover:border-tp-hairline'
        }`}
      >
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <span className="max-w-[180px] truncate">{displayLabel}</span>
        <svg className={`h-3 w-3 shrink-0 text-tp-steel transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={dropdownVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={transitionFast}
            role="dialog"
            aria-label="Pick date range"
            className="absolute right-0 top-full z-50 mt-1 w-[300px] origin-top-right rounded-lg border border-tp-hairline bg-tp-canvas p-3 shadow-elevation-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: month navigation */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setViewMonth(prev => subMonths(prev, 1))}
                className="cursor-pointer rounded-md p-1 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>
              <span className="text-sm font-medium text-tp-ink">{format(viewMonth, 'MMMM yyyy')}</span>
              <button
                type="button"
                onClick={() => setViewMonth(prev => addMonths(prev, 1))}
                className="cursor-pointer rounded-md p-1 text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>

            {/* Weekday headers */}
            <div className="mb-1 grid grid-cols-7">
              {WEEKDAYS.map(d => (
                <div key={d} className="py-1 text-center text-[10px] font-medium text-tp-muted">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-y-0.5">
              {calendarDays.map((day) => {
                const inMonth = isSameMonth(day, viewMonth);
                const isStart = startDate && isSameDay(day, startDate);
                const isEnd = endDate && isSameDay(day, endDate);
                const isHoverEnd = !endDate && selectingEnd && hoverDate && isSameDay(day, hoverDate) && isAfter(hoverDate, startDate!);
                const inRange = startDate && effectiveEnd && isAfter(day, startDate) && isBefore(day, effectiveEnd);
                const today = isToday(day);

                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => handleDayClick(day)}
                    onMouseEnter={() => selectingEnd && setHoverDate(day)}
                    onMouseLeave={() => setHoverDate(null)}
                    disabled={!inMonth}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-full text-xs transition-colors cursor-pointer
                      ${!inMonth ? 'text-tp-muted/40 cursor-default' : ''}
                      ${inMonth && !isStart && !isEnd && !inRange ? 'text-tp-ink hover:bg-tp-surface' : ''}
                      ${(isStart || isEnd || isHoverEnd) ? 'bg-tp-primary text-tp-on-primary font-medium' : ''}
                      ${inRange && !isStart && !isEnd ? 'bg-tp-primary/10 text-tp-primary' : ''}
                      ${today && !isStart && !isEnd && !isHoverEnd ? 'ring-1 ring-tp-primary/30' : ''}
                    `}
                  >
                    {format(day, 'd')}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-2 flex items-center justify-between border-t border-tp-hairline pt-2">
              {hasRange || startDate ? (
                <button
                  type="button"
                  onClick={handleClear}
                  className="cursor-pointer text-[11px] text-tp-muted transition-colors hover:text-red-500"
                >
                  Clear
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="cursor-pointer rounded-md bg-tp-primary px-3 py-1 text-[11px] font-medium text-tp-on-primary transition-colors hover:bg-tp-primary-deep"
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
