import { BADGE_SHAPE } from './badgeTones';
import { channelStyle } from './interfaces';

/** The short tag of an interface's channel, as in Helena's tree: Int, Prog, Conv, Agent, Event. */
export default function ChannelTag({
  channel,
  full = false,
}: {
  channel: string | null;
  full?: boolean;
}) {
  const style = channelStyle(channel);
  return (
    <span
      title={style.label}
      className={`${BADGE_SHAPE} min-w-[2.6rem] shrink-0 justify-center !px-1.5 !text-[10px] ${style.className}`}
    >
      {full ? style.label : style.tag}
    </span>
  );
}
