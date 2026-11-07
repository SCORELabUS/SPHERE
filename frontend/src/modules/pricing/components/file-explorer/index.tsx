import * as React from 'react';
import clsx from 'clsx';
import { animated, useSpring } from '@react-spring/web';
import { styled, alpha } from '@mui/material/styles';
import { TransitionProps } from '@mui/material/transitions';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import ArticleIcon from '@mui/icons-material/Article';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderRounded from '@mui/icons-material/FolderRounded';
import ImageIcon from '@mui/icons-material/Image';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import VideoCameraBackIcon from '@mui/icons-material/VideoCameraBack';
import { RichTreeView } from '@mui/x-tree-view/RichTreeView';
import { treeItemClasses } from '@mui/x-tree-view/TreeItem';
import { useTreeItem2, UseTreeItem2Parameters } from '@mui/x-tree-view/useTreeItem2';
import {
  TreeItem2Checkbox,
  TreeItem2Content,
  TreeItem2IconContainer,
  TreeItem2Label,
  TreeItem2Root,
} from '@mui/x-tree-view/TreeItem2';
import { TreeItem2Icon } from '@mui/x-tree-view/TreeItem2Icon';
import { TreeItem2Provider } from '@mui/x-tree-view/TreeItem2Provider';
import { TreeItem2DragAndDropOverlay } from '@mui/x-tree-view/TreeItem2DragAndDropOverlay';
import { TreeViewBaseItem } from '@mui/x-tree-view/models';
import { AnalyticsDataEntry } from '../../../../assets/data/analytics';
import { IconButton, Modal, Paper } from '@mui/material';
import { Download, OpenInNew } from '@mui/icons-material';
import { parseStringYamlToEncodedYaml } from '../../../pricing-editor/services/export.service';
import customAlert from '../../../core/utils/custom-alert';
import { MdDeleteForever } from 'react-icons/md';
import customConfirm from '../../../core/utils/custom-confirm';
import { usePricingsApi } from '../../api/pricingsApi';
import { IoIosLink } from 'react-icons/io';
import CopyToClipboardIcon from '../../../core/components/copy-icon';
import { FileExplorerContext } from '../../contexts/fileExplorerContext';
import { useAuth } from '../../../auth/hooks/useAuth';
import { v4 as uuidv4 } from 'uuid';
import { useCacheApi } from '../../../pricing-editor/api/cacheApi';

type FileType = 'image' | 'pdf' | 'doc' | 'video' | 'folder' | 'pinned' | 'trash';

type ExtendedTreeItemProps = {
  fileType?: FileType;
  id: string;
  label: string;
};

declare module 'react' {
  interface CSSProperties {
    '--tree-view-color'?: string;
    '--tree-view-bg-color'?: string;
  }
}

const StyledTreeItemRoot = styled(TreeItem2Root)(({ theme }) => ({
  color: theme.palette.grey[400],
  position: 'relative',
  [`& .${treeItemClasses.groupTransition}`]: {
    marginLeft: theme.spacing(3.5),
  },
  ...theme.applyStyles('light', {
    color: theme.palette.grey[800],
  }),
})) as unknown as typeof TreeItem2Root;

const CustomTreeItemContent = styled(TreeItem2Content)(({ theme }) => ({
  flexDirection: 'row-reverse',
  borderRadius: theme.spacing(0.7),
  marginBottom: theme.spacing(0.5),
  marginTop: theme.spacing(0.5),
  padding: theme.spacing(0.5),
  paddingRight: theme.spacing(1),
  fontWeight: 500,
  [`&.Mui-expanded `]: {
    '&:not(.Mui-focused, .Mui-selected, .Mui-selected.Mui-focused) .labelIcon': {
      color: theme.palette.primary.dark,
      ...theme.applyStyles('light', {
        color: theme.palette.primary.main,
      }),
    },
    '&::before': {
      content: '""',
      display: 'block',
      position: 'absolute',
      left: '16px',
      top: '44px',
      height: 'calc(100% - 48px)',
      width: '1.5px',
      backgroundColor: theme.palette.grey[700],
      ...theme.applyStyles('light', {
        backgroundColor: theme.palette.grey[300],
      }),
    },
  },
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
    color: 'white',
    ...theme.applyStyles('light', {
      color: theme.palette.primary.main,
    }),
  },
  [`&.Mui-focused, &.Mui-selected, &.Mui-selected.Mui-focused`]: {
    backgroundColor: theme.palette.primary.dark,
    color: theme.palette.primary.contrastText,
    ...theme.applyStyles('light', {
      backgroundColor: theme.palette.primary.light,
    }),
  },
}));

const AnimatedCollapse = animated(Collapse);

function TransitionComponent(props: TransitionProps) {
  const style = useSpring({
    to: {
      opacity: props.in ? 1 : 0,
      transform: `translate3d(0,${props.in ? 0 : 20}px,0)`,
    },
  });

  return <AnimatedCollapse style={style} {...props} />;
}

const StyledTreeItemLabelText = styled(Typography)({
  color: 'inherit',
  fontFamily: 'inherit',
  fontWeight: 500,
  fontSize: '1rem',
}) as unknown as typeof Typography;

interface CustomLabelProps {
  children: React.ReactNode;
  icon?: React.ElementType;
  expandable?: boolean;
  fileType?: FileType;
}

function CustomLabel({ icon: Icon, expandable, children, fileType, ...other }: CustomLabelProps) {
  const { removePricingVersion } = usePricingsApi();

  const { pricingOwner, setSelectedYamlLink, setYamlLinkModalOpen } =
    React.useContext(FileExplorerContext);

  const { authUser } = useAuth();
  const {getFromCache, setInCache} = useCacheApi();

  const handleDownload = (children: React.ReactNode) => {
    if (!children) {
      customAlert('No file selected.');
      return;
    }
    const fileName = children.toString();

    if (fileName) {
      const saasName = fileName.split('/')[fileName.split('/').length - 2];
      const version = fileName.split('/')[fileName.split('/').length - 1];

      fetch(fileName).then(async response => {
        const blob = await response.blob();
        const objectURL = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectURL;
        link.download = `${saasName}-${version}`;
        document.body.appendChild(link);
        link.click();

        // Clean DOM and revoke object URL
        document.body.removeChild(link);
        URL.revokeObjectURL(objectURL);
      });
    } else {
      customAlert(`File path for ${fileName} not found.`);
    }
  };

  const handleOpen = (children: React.ReactNode) => {
    if (!children) {
      customAlert('No file selected.');
      return;
    }
    const fileName = children.toString();

    fetch(fileName).then(async response => {
      const text = await response.text();
      const urlParam = parseStringYamlToEncodedYaml(text);
      const assignedId = uuidv4();

      setInCache(assignedId, urlParam, 24 * 60 * 60).then(() => {
        window.open(`/editor?pricing=${assignedId}`, '_blank');
      }) // 24h
    });
  };

  const handleCopyLink = (children: React.ReactNode) => {
    if (!children) {
      customAlert('No file selected.');
      return;
    }

    const fileName = children.toString();

    setSelectedYamlLink(fileName);
    setYamlLinkModalOpen(true);
  };

  const handleDeleteVersion = async (children: React.ReactNode) => {
    if (!children) {
      customAlert('No file selected.');
      return;
    }

    const fileName = children.toString();
    const saasName = fileName.split('/')[fileName.split('/').length - 2];
    const version = fileName.split('/')[fileName.split('/').length - 1].replace(/\.[^/.]+$/, "").replace(/\./g, "_");


    customConfirm(`Are you sure you want to delete ${saasName}-${version}?`).then(() => {
      removePricingVersion(saasName, version)
        .then(() => {
          customAlert(`${saasName}-${version} has been deleted.`).then(() =>
            window.location.reload()
          );
        })
        .catch(_ => {
          customAlert(
            `Failed to delete ${saasName}-${version}. Please, try again later or contact with support.`
          );
        });
    });
  };

  return (
    <TreeItem2Label
      {...other}
      sx={{
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {Icon && (
        <Box
          component={Icon}
          className="labelIcon"
          color="inherit"
          sx={{ mr: 1, fontSize: '1.2rem' }}
        />
      )}

      <StyledTreeItemLabelText variant="body2">
        {children?.toString().split('/')[children?.toString().split('/').length - 1]}
      </StyledTreeItemLabelText>
      <Box
        sx={{
          ml: 'auto',
          color: 'text.secondary',
          fontSize: '0.75rem',
          fontWeight: 400,
        }}
      >
        {/* 150 KB • 2 days ago */}
        {fileType === 'doc' && (
          <>
            <IconButton size="small" sx={{ ml: 1 }} onClick={() => handleDownload(children)}>
              <Download />
            </IconButton>
            <IconButton size="small" sx={{ ml: 1 }} onClick={() => handleOpen(children)}>
              <OpenInNew />
            </IconButton>
            <IconButton size="small" sx={{ ml: 1 }} onClick={() => handleCopyLink(children)}>
              <IoIosLink fontSize={25} />
            </IconButton>
            {authUser.user && pricingOwner === authUser.user.username && (
              <IconButton size="small" sx={{ ml: 1 }} onClick={() => handleDeleteVersion(children)}>
                <MdDeleteForever fontSize={25} />
              </IconButton>
            )}
          </>
        )}
      </Box>
    </TreeItem2Label>
  );
}

const isExpandable = (reactChildren: React.ReactNode) => {
  if (Array.isArray(reactChildren)) {
    return reactChildren.length > 0 && reactChildren.some(isExpandable);
  }
  return Boolean(reactChildren);
};

const getIconFromFileType = (fileType: FileType) => {
  switch (fileType) {
    case 'image':
      return ImageIcon;
    case 'pdf':
      return PictureAsPdfIcon;
    case 'doc':
      return ArticleIcon;
    case 'video':
      return VideoCameraBackIcon;
    case 'folder':
      return FolderRounded;
    case 'pinned':
      return FolderOpenIcon;
    case 'trash':
      return DeleteIcon;
    default:
      return ArticleIcon;
  }
};

interface CustomTreeItemProps
  extends Omit<UseTreeItem2Parameters, 'rootRef'>,
    Omit<React.HTMLAttributes<HTMLLIElement>, 'onFocus'> {}
const CustomTreeItem = React.forwardRef(function CustomTreeItem(
  props: CustomTreeItemProps,
  ref: React.Ref<HTMLLIElement>
) {
  const { id, itemId, label, disabled, children, ...other } = props;

  const {
    getRootProps,
    getContentProps,
    getIconContainerProps,
    getCheckboxProps,
    getLabelProps,
    getGroupTransitionProps,
    getDragAndDropOverlayProps,
    status,
    publicAPI,
  } = useTreeItem2({ id, itemId, children, label, disabled, rootRef: ref });

  const item = publicAPI.getItem(itemId);
  const expandable = isExpandable(children);
  let icon;
  if (expandable) {
    icon = FolderRounded;
  } else if (item.fileType) {
    icon = getIconFromFileType(item.fileType);
  }

  return (
    <TreeItem2Provider itemId={itemId}>
      <StyledTreeItemRoot {...getRootProps(other)}>
        <CustomTreeItemContent
          {...getContentProps({
            className: clsx('content', {
              'Mui-expanded': status.expanded,
              'Mui-selected': status.selected,
              'Mui-focused': status.focused,
              'Mui-disabled': status.disabled,
            }),
          })}
        >
          <TreeItem2IconContainer {...getIconContainerProps()}>
            <TreeItem2Icon status={status} />
          </TreeItem2IconContainer>
          <TreeItem2Checkbox {...getCheckboxProps()} />
          <CustomLabel
            {...getLabelProps({ icon, expandable: expandable && status.expanded })}
            fileType={item.fileType}
          />
          <TreeItem2DragAndDropOverlay {...getDragAndDropOverlayProps()} />
        </CustomTreeItemContent>
        {children && <TransitionComponent {...getGroupTransitionProps()} />}
      </StyledTreeItemRoot>
    </TreeItem2Provider>
  );
});

export default function FileExplorer({ pricingData }: { pricingData: AnalyticsDataEntry[] }) {
  const [items, setItems] = React.useState<TreeViewBaseItem<ExtendedTreeItemProps>[]>([]);
  const [selectedYamlLink, setSelectedYamlLink] = React.useState<string>('');
  const [yamlLinkModalOpen, setYamlLinkModalOpen] = React.useState<boolean>(false);

  function handleYamlLinkModalClose() {
    setYamlLinkModalOpen(false);
  }

  React.useEffect(() => {
    const pricingItems = pricingData.map((entry, index) => ({
      id: `pricing-${index}`,
      label: entry.yaml,
      fileType: 'doc' as FileType,
    }));

    setItems([
      {
        id: 'pricings',
        label: 'Pricings',
        fileType: 'folder',
        children: pricingItems,
      },
    ]);
  }, [pricingData]);

  const contextValue = React.useMemo(
    () => ({
      pricingOwner: pricingData[0].owner.username,
      selectedYamlLink,
      setSelectedYamlLink,
      yamlLinkModalOpen,
      setYamlLinkModalOpen,
    }),
    [pricingData, selectedYamlLink, yamlLinkModalOpen]
  );

  return (
    <FileExplorerContext.Provider value={contextValue}>
      <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            p: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" component="div">
            File Explorer
          </Typography>
          {/* <Box sx={{ display: 'flex', gap: 2 }}>
                        <Typography variant="body2" component="div">
                            Size
                        </Typography>
                        <Typography variant="body2" component="div">
                            Last Modified
                        </Typography>
                    </Box> */}
        </Box>
        <RichTreeView
          items={items}
          defaultExpandedItems={['pricings']}
          defaultSelectedItems="pricings"
          sx={{ height: 'fit-content', flexGrow: 1, overflowY: 'auto' }}
          slots={{ item: CustomTreeItem }}
        />
      </Box>
      <Modal
        open={yamlLinkModalOpen}
        onClose={handleYamlLinkModalClose}
        aria-labelledby="modal-yaml-link-title"
        aria-describedby="modal-yaml-link-description"
      >
        <Paper
          elevation={3}
          sx={{
            maxWidth: 600,
            width: '90vw',
            mx: 'auto',
            mt: 4,
            p: 4,
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translateX(-50%) translateY(-50%)',
            borderRadius: '20px',
          }}
        >
          <Typography
            variant="h6"
            component="h2"
            gutterBottom
            sx={{
              textAlign: 'center',
              fontWeight: 'bold',
            }}
          >
            Your link is ready!
          </Typography>
          <Typography sx={{ mt: 2, mb: 3, textAlign: 'center' }}>
            This link points directly to the YAML file of the selected pricing version. It can be
            used to leverage some functionalities within the{' '}
            <a href="https://pricing4saas-docs.vercel.app" target="_blank">
              Pricing4SaaS suite
            </a>
            .
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <CopyToClipboardIcon value={selectedYamlLink} />
          </Box>
        </Paper>
      </Modal>
    </FileExplorerContext.Provider>
  );
}
