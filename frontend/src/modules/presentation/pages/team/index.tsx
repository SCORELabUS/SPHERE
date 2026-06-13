import { Helmet } from "react-helmet-async";
import { teamMembers } from "./data/team-data.tsx";
import TeamMemberCard from "../../layouts/components/team-member-card";

export default function TeamPage(){
    return(
        <>
            <Helmet>
                <title> SPHERE - Team </title>
            </Helmet>
            <div className="m-auto flex w-dvw max-w-[2000px] flex-wrap justify-evenly gap-20 px-[20px] pb-[15px] pt-[50px]">
            {
                teamMembers.map((member) => {
                    return(
                        <TeamMemberCard member={member}/>
                    )
                })
            }
            </div>
            
        </>
    )
}