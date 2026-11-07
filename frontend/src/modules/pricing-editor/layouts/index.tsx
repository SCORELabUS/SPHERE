import { Box, Modal, Paper, Tab, Tabs, Typography } from '@mui/material';
import Header from './header';
import Main from './main';
import { useState } from 'react';
import { createUrlWithEncodedYaml, parseStringYamlToEncodedYaml } from '../services/export.service';
import CopyToClipboardIcon from '../../core/components/copy-icon';
import { EditorValueContext } from '../contexts/editorValueContext';
import FileUpload from '../../core/components/file-upload-input';
import { flex } from '../../core/theme/css';
import customAlert from '../../core/utils/custom-alert';
import { useCacheApi } from '../api/cacheApi';
import { v4 as uuidv4 } from 'uuid';

export default function EditorLayout({ children }: { children?: React.ReactNode }) {
  const [sharedLinkModalOpen, setSharedLinkModalOpen] = useState(false);
  const [importModalOpen, setImportLinkModalOpen] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const [tabValue, setTabValue] = useState(0);

  const { setInCache } = useCacheApi();

  const renderSharedLink = () => {
    setSharedLinkModalOpen(true);
  };

  const handleSharedLinkClose = () => {
    setSharedLinkModalOpen(false);
  };

  const renderYamlImport = () => {
    setImportLinkModalOpen(true);
  };

  const handleYamlImportClose = () => {
    setImportLinkModalOpen(false);
  };

  const handleCopyToClipboard = () => {
    if (sharedLinkModalOpen) {
      if (tabValue === 1) { // Full export
        const encodedPricing = parseStringYamlToEncodedYaml(editorValue);

        return createUrlWithEncodedYaml(encodedPricing);
      } else {
        const urlParams = new URLSearchParams(window.location.search);
        const assignedId = urlParams.get('pricing') ?? uuidv4();

        const encodedPricing = parseStringYamlToEncodedYaml(editorValue);

        setInCache(assignedId, encodedPricing, 24 * 60 * 60) // 24h
          .catch(error => {
            customAlert(`Error saving link in cache: ${error}`);
          });

        return createUrlWithEncodedYaml(assignedId);
      }
    } else {
      return '';
    }
  };

  const onSubmitImport = (file: File) => {
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditorValue(reader.result as string);
      };
      reader.readAsText(file);
    } else {
      customAlert('No file selected');
    }
  };

  return (
    <EditorValueContext.Provider value={{ editorValue, setEditorValue }}>
      <Box
        component="div"
        sx={{ display: 'grid', minHeight: '100dvh', gridTemplateRows: 'auto 1fr' }}
      >
        <Header renderSharedLink={renderSharedLink} renderYamlImport={renderYamlImport} />
        <Main>{children}</Main>
      </Box>
      <Modal
        open={sharedLinkModalOpen}
        onClose={handleSharedLinkClose}
        aria-labelledby="modal-shared-link-title"
        aria-describedby="modal-shared-link-description"
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
            Your pricing is a step away from the world
          </Typography>
          <Typography sx={{ mt: 2, mb: 3, textAlign: 'center' }}>
            Share this link to allow other users to see and edit their own version of your pricing
          </Typography>

          <Box sx={{ ...flex({justify: "center"}), mb: 2 }}>
            <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
              <Tab label="Short encoding" />
              <Tab label="Full encoding" />
            </Tabs>
          </Box>

          {
            tabValue === 1 ? (
              <Typography
                variant="body2"
                color="error"
                sx={{ textAlign: 'center', mb: 2 }}
              >
                <strong>WARNING:</strong> If the YAML is too large, the URL might not be processed correctly.
              </Typography>
            )
            :
            (
              <Typography
                variant="body2"
                color="info"
                sx={{ textAlign: 'center', mb: 2 }}
              >
                <strong>INFO:</strong> The generated URL will only be available for 24h.
              </Typography>
            )
          }

          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <CopyToClipboardIcon value={handleCopyToClipboard()} />
          </Box>
        </Paper>
      </Modal>
      <Modal
        open={importModalOpen}
        onClose={handleYamlImportClose}
        aria-labelledby="modal-import-title"
        aria-describedby="modal-import-description"
      >
        <Paper
          elevation={3}
          sx={{
            maxWidth: 500,
            width: '90dvw',
            mx: 'auto',
            mt: 4,
            p: 4,
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translateX(-50%) translateY(-50%)',
            borderRadius: '20px',
            ...flex({ direction: 'column' }),
          }}
        >
          <FileUpload onSubmit={onSubmitImport} />
        </Paper>
      </Modal>
    </EditorValueContext.Provider>
  );
}
