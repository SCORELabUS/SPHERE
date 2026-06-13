import { Helmet } from 'react-helmet-async';
import timelineData from './data/research-data';
import Timeline from './components/timeline';

export default function ResearchPage() {
  return (
    <>
      <Helmet>
        <title>SPHERE - Research</title>
      </Helmet>
      <div className="h-full w-full overflow-y-scroll bg-tp-surface p-4 pb-16 md:p-8">
        <div className="mx-auto max-w-5xl">
          <Timeline items={timelineData} />
        </div>
      </div>
    </>
  );
}
