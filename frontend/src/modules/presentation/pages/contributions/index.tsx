import { useState } from 'react';
import { Contribution, contributions } from './data/contributions-data';
import ContributionCard from '../../layouts/components/contribution-card';
import { Helmet } from 'react-helmet-async';
import ContributionDetailsModal from '../../layouts/components/contribution-details';
import { v4 as uuidv4 } from 'uuid';

export default function ContributionsPage() {
  const [open, setOpen] = useState(false);
  const [selectedContribution, setSelectedContribution] = useState<Contribution | null>(null);

  const handleOpen = (contribution: any) => {
    setSelectedContribution(contribution);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedContribution(null);
  };

  return (
    <>
      <Helmet>
        <title> SPHERE - Contributions </title>
      </Helmet>
      <div className="m-auto flex w-dvw flex-wrap justify-evenly gap-4 px-[20px] pb-[15px] pt-[50px]">
        {contributions.map((contribution) => (
          <ContributionCard 
            key={uuidv4()} 
            onClick={() => handleOpen(contribution)} 
            contribution={contribution} 
          />
        ))}
      </div>

      <ContributionDetailsModal selectedContribution={selectedContribution} isOpen={open} handleClose={handleClose}/>
    </>
  );
}
