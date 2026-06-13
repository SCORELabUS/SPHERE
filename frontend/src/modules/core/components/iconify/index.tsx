import PropTypes, { InferProps } from 'prop-types';
import { forwardRef, ReactElement, RefAttributes } from 'react';
import {
    MdOutlineGroup,
    MdGroupAdd,
    MdPersonOutline,
    MdPersonRemove,
    MdPersonSearch,
    MdArrowBack,
    MdNotificationsActive,
    MdNotificationsOff,
    MdNotificationsNone,
    MdCalendarToday,
    MdCheck,
    MdCheckCircleOutline,
    MdExpandMore,
    MdChevronRight,
    MdClose,
    MdContentCopy,
    MdDomain,
    MdFolderOff,
    MdAccountTree,
    MdInbox,
    MdLink,
    MdLinkOff,
    MdAddLink,
    MdAutorenew,
    MdLockOutline,
    MdLogout,
    MdAdd,
    MdAddCircleOutline,
    MdEdit,
    MdSend,
    MdVerifiedUser,
    MdSecurity,
    MdLabelOff,
    MdLabelOutline,
    MdOutlineFolder,
    MdOutlineDashboard,
    MdDelete,
    MdVpnKey,
} from 'react-icons/md';
import { IconType } from 'react-icons';

const iconMap: Record<string, IconType> = {
    'mdi:account-group-outline': MdOutlineGroup,
    'mdi:account-plus-outline': MdGroupAdd,
    'mdi:account-outline': MdPersonOutline,
    'mdi:account-remove-outline': MdPersonRemove,
    'mdi:account-search': MdPersonSearch,
    'mdi:arrow-left': MdArrowBack,
    'mdi:bell-badge-outline': MdNotificationsActive,
    'mdi:bell-off': MdNotificationsOff,
    'mdi:bell-outline': MdNotificationsNone,
    'mdi:calendar-outline': MdCalendarToday,
    'mdi:check': MdCheck,
    'mdi:check-circle-outline': MdCheckCircleOutline,
    'mdi:chevron-down': MdExpandMore,
    'mdi:chevron-right': MdChevronRight,
    'mdi:close': MdClose,
    'mdi:content-copy': MdContentCopy,
    'mdi:domain': MdDomain,
    'mdi:folder-off-outline': MdFolderOff,
    'mdi:graph-outline': MdAccountTree,
    'mdi:inbox': MdInbox,
    'mdi:link': MdLink,
    'mdi:link-off': MdLinkOff,
    'mdi:link-plus': MdAddLink,
    'mdi:link-variant-off': MdLinkOff,
    'mdi:loading': MdAutorenew,
    'mdi:lock-outline': MdLockOutline,
    'mdi:logout': MdLogout,
    'mdi:plus': MdAdd,
    'mdi:plus-circle-outline': MdAddCircleOutline,
    'mdi:pencil-outline': MdEdit,
    'mdi:send': MdSend,
    'mdi:shield-check-outline': MdVerifiedUser,
    'mdi:shield-lock-outline': MdSecurity,
    'mdi:tag-off-outline': MdLabelOff,
    'mdi:tag-outline': MdLabelOutline,
    'mdi:folder-outline': MdOutlineFolder,
    'mdi:link-variant': MdLink,
    'mdi:trash-can-outline': MdDelete,
    'mdi:view-dashboard-outline': MdOutlineDashboard,
    'mdi:key': MdVpnKey,
};

type IconifyProps = {
    icon: ReactElement | string;
    width?: number;
    color?: string;
    className?: string;
} & RefAttributes<HTMLSpanElement>;

const Iconify = forwardRef<HTMLSpanElement, IconifyProps>(
    ({ icon, width = 20, color, className, ...other }, ref) => {
        const iconName = icon as string;
        const IconComponent = iconMap[iconName];

        if (!IconComponent) {
            console.warn(`Icon not found: ${iconName}`);
            return null;
        }

        return (
            <span
                ref={ref}
                className={`component-iconify inline-flex ${className ?? ''}`}
                {...other}
            >
                <IconComponent size={width} color={color} />
            </span>
        );
    }
);

Iconify.propTypes = {
    icon: PropTypes.oneOfType([PropTypes.element, PropTypes.string]),
    width: PropTypes.number,
    color: PropTypes.string,
} as InferProps<typeof Iconify.propTypes>;

export default Iconify;
