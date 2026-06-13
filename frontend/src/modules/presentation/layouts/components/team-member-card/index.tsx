import { MdEmail, MdLanguage } from 'react-icons/md';
import { FaLinkedin, FaTwitter, FaGithub, FaOrcid } from 'react-icons/fa';
import {FaGoogleScholar} from 'react-icons/fa6';
import { AiOutlineProject } from 'react-icons/ai';
import { TeamMember } from '../../../pages/team/data/team-data';

export default function TeamMemberCard({ member }: { member: TeamMember }) {
  const iconButtonClass = 'cursor-pointer rounded-full p-2 text-sphere-grey-700 transition-colors hover:bg-sphere-grey-200';

  return (
    <div className="mx-auto w-[90dvw] max-w-[400px] rounded-xl bg-white shadow-[0_8px_40px_-12px_rgba(0,0,0,0.3)] transition duration-300 hover:shadow-[0_16px_70px_-12.125px_rgba(0,0,0,0.3)]">
      <div className="mx-auto my-5 flex h-[250px] w-[250px] items-center justify-center overflow-hidden rounded-full border-4 border-white shadow-md">
        {member.profilePicture ? (
          <img src={member.profilePicture} alt={`${member.firstName} ${member.lastName}`} className="h-full w-full object-cover" />
        ) : (
          <p className="text-5xl font-bold">{`${member.firstName[0]}${member.lastName[0]}`}</p>
        )}
      </div>
      <div className="p-4 text-center">
        <h3 className="text-2xl font-semibold">
          {member.firstName} {member.lastName}
        </h3>
        <p className="text-sm text-sphere-grey-600">
          {member.role}
        </p>
        {member.affiliation}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <a title="Email" href={`mailto:${member.email}`} aria-label="Email" className={iconButtonClass}>
              <MdEmail />
          </a>
          {member.website && (
              <a title="Website" href={member.website} target="_blank" rel="noopener noreferrer" aria-label="Website" className={iconButtonClass}>
                <MdLanguage />
              </a>
          )}
          {member.linkedin && (
              <a title="LinkedIn" href={member.linkedin} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" className={iconButtonClass}>
                <FaLinkedin />
              </a>
          )}
          {member.twitter && (
              <a title="Twitter" href={member.twitter} target="_blank" rel="noopener noreferrer" aria-label="Twitter" className={iconButtonClass}>
                <FaTwitter />
              </a>
          )}
          {member.github && (
              <a title="GitHub" href={member.github} target="_blank" rel="noopener noreferrer" aria-label="GitHub" className={iconButtonClass}>
                <FaGithub />
              </a>
          )}
          {member.googlescholar && (
              <a title="Google Scholar" href={member.googlescholar} target="_blank" rel="noopener noreferrer" aria-label="Google Scholar" className={iconButtonClass}>
                <FaGoogleScholar />
              </a>
          )}
          {member.researchGate && (
              <a title="ResearchGate" href={member.researchGate} target="_blank" rel="noopener noreferrer" aria-label="ResearchGate" className={iconButtonClass}>
                <AiOutlineProject />
              </a>
          )}
          {member.orcid && (
              <a title="ORCID" href={`https://orcid.org/${member.orcid}`} target="_blank" rel="noopener noreferrer" aria-label="ORCID" className={iconButtonClass}>
                <FaOrcid/>
              </a>
          )}
        </div>
      </div>
    </div>
  );
}
