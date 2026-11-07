import { Helmet } from 'react-helmet';
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Container,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
  styled,
} from '@mui/material';
import { Favorite, LibraryAdd, LibraryAddCheck, FavoriteBorder } from '@mui/icons-material';
import PricingTree from '../../components/pricing-tree';
import {
  SpherePricingRenderer,
  pricingRendererSource,
} from '../../../core/components/pricing-renderer';
import { Pricing, retrievePricingFromYaml } from 'pricing4ts';
import FileExplorer from '../../components/file-explorer';
import { AnalyticsDataEntry } from '../../../../assets/data/analytics';
import { usePathname } from '../../../core/hooks/usePathname';
import Stats from '../../components/stats';
import Analytics from '../../components/analytics';
// import Harvey from '../../components/harvey';
import AnalyticsModal from '../../components/analyticsModal';
import { usePricingsApi } from '../../api/pricingsApi';
import PricingSettings from '../../components/pricing-settings';
import customAlert from '../../../core/utils/custom-alert';
import { useAuth } from '../../../auth/hooks/useAuth';
import { Link } from 'react-router-dom';
import { useQueryParams } from '../../../core/hooks/useQueryParams';
import ConfigurationSpaceView from '../../components/configuration-space-view';

export const StyledChip = styled(Chip)(({ theme }) => ({
  margin: theme.spacing(0.5),
  borderRadius: '4px',
}));

export const CURRENCIES = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
};

export default function CardPage() {
  const [tabValue, setTabValue] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isModalOpen, setModalOpen] = useState(false);
  const [fullPricingData, setFullPricingData] = useState<AnalyticsDataEntry[] | null>(null);
  const [pricingData, setPricingData] = useState<AnalyticsDataEntry[] | null>(null);
  const [currentPricing, setCurrentPricing] = useState<AnalyticsDataEntry | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pricingYamlText, setPricingYamlText] = useState<string | null>(null);
  const [oldestPricingDate, setOldestPricingDate] = useState<string | null>(null);

  const pathname = usePathname();
  const queryParams = useQueryParams();
  const { getPricingByName, updateClientPricingVersion } = usePricingsApi();
  const { authUser } = useAuth();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function updatePricingInformation(pricing: any) {
    if (pricing.versions && pricing.versions.length > 0) {
      const currentPricing = pricing.versions[0];
      const oldestPricing = pricing.versions[pricing.versions.length - 1];
      setFullPricingData(pricing.versions);
      setPricingData(pricing.versions);
      setCurrentPricing(currentPricing);
      setOldestPricingDate(oldestPricing.extractionDate);
    } else {
      throw new Error('No pricing versions found');
    }
  }

  useEffect(() => {
    const name = pathname.split('/').pop() as string;
    const owner = pathname.split('/')[pathname.split('/').length - 2] as string;
    const collectionName: string | null = queryParams.get('collectionName');

    getPricingByName(name, owner, collectionName).then(pricing => {
      try {
        updatePricingInformation(pricing);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        customAlert(err.msg);
      }
    });
  }, [pathname]);

  useEffect(() => {
    if (currentPricing === null) {
      return;
    }

    const pricingYamlPath = currentPricing.yaml;

    fetch(pricingYamlPath).then(async response => {
      let p: string = '';
      p = await response.text();

      let parsedPricing: Pricing | null = null;

      try{
        parsedPricing = retrievePricingFromYaml(p);
      }catch{
        if (!(/syntaxVersion\s*:\s*["']?3\.0["']?/.test(p))) {
          parsedPricing = await updateClientPricingVersion(p);
        }
      }

      setPricing(parsedPricing);
      setPricingYamlText(p);
    });
  }, [pricingData, currentPricing]);

  const toggleModal = () => {
    setModalOpen(!isModalOpen);
  };

  const handleInputDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPricingData = fullPricingData?.filter(
      entry => new Date(entry.extractionDate) >= new Date(e.target.value)
    );
    if (newPricingData) {
      setPricingData(newPricingData);
    } else {
      setPricingData([]);
    }
  };

  const handleOutputDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPricingData = fullPricingData?.filter(
      entry => new Date(entry.extractionDate) <= new Date(e.target.value)
    );
    if (newPricingData) {
      setPricingData(newPricingData);
    } else {
      setPricingData([]);
    }
  };

  const handleVersionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPricing = pricingData?.find(entry => entry.yaml == e.target.value);
    if (newPricing) {
      setCurrentPricing(newPricing);
    }
  };

  // The renderer parses the author's own document when it can (Pricing2Yaml 3.x) and falls back to
  // the version-upgraded pricing object for anything older. See core/components/pricing-renderer.
  const rendererSource = pricingRendererSource(pricingYamlText, pricing);

  return (
    <>
      <Helmet>
        <title> {`SPHERE - ${pricing?.saasName} Pricing`} </title>
      </Helmet>
      <Container maxWidth="xl">
        <Box sx={{ my: 4 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" flexDirection="column">
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Typography variant="h5" letterSpacing={1}>
                  {currentPricing?.collectionName && (
                    <>
                      <Box component="span" sx={{ color: 'text.secondary', mr: 0.25 }}>
                        {currentPricing?.collectionName}
                      </Box>
                      <Box component="span" sx={{ color: 'text.secondary', mr: 0.25 }}>
                        /
                      </Box>
                    </>
                  )}
                  {pricing?.saasName}
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={isLiked ? <Favorite /> : <FavoriteBorder />}
                  onClick={() => setIsLiked(!isLiked)}
                  sx={{ mr: 1 }}
                >
                  {isLiked ? '151' : '150'}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={isFollowing ? <LibraryAddCheck /> : <LibraryAdd />}
                  size="small"
                  onClick={() => setIsFollowing(!isFollowing)}
                >
                  {isFollowing ? 'Following' : 'Follow'}
                </Button>
              </Box>

              {/* <Box display="flex" flexWrap="wrap" gap={1} mb={2}>
              <StyledChip label="Productivity" variant="outlined" />
              <StyledChip label="Freemium" variant="outlined" />
              <StyledChip label="Microsoft" variant="outlined" />
              <StyledChip label="+1M users" variant="outlined" />
              <StyledChip label="USD" variant="outlined" />
              <StyledChip label="USA" variant="outlined" />
            </Box>

            <Typography variant="body2" color="text.secondary" mb={2}>
              More info
            </Typography> */}

              {currentPricing && currentPricing.collectionName && (
                <Typography variant="h6" color="text.secondary" mb={2} fontWeight="bold">
                  Collection:{' '}
                  <Link
                    to={`/pricings/collections/${currentPricing.owner.id}/${currentPricing.collectionName}`}
                  >
                    {currentPricing.collectionName}
                  </Link>
                </Typography>
              )}

              <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <Tabs value={tabValue} onChange={(_, v) => setTabValue(v)}>
                  <Tab label="Pricing card" />
                  <Tab label="Configuration Space Details" />
                  <Tab label="Files and versions" />
                  {currentPricing &&
                    authUser.user &&
                    currentPricing.owner.username === authUser.user.username && (
                      <Tab label="Settings" />
                    )}
                </Tabs>
              </Box>
            </Box>
            <Box display="flex" flexDirection="column" gap={2}>
              <Box display="flex" gap={2}>
                {oldestPricingDate && (
                  <>
                    <TextField
                      label="Start Date"
                      type="date"
                      fullWidth
                      defaultValue={new Date(oldestPricingDate).toISOString().split('T')[0]}
                      slotProps={{ inputLabel: { shrink: true } }}
                      onChange={handleInputDate}
                    />
                    <TextField
                      label="End Date"
                      type="date"
                      fullWidth
                      slotProps={{ inputLabel: { shrink: true } }}
                      onChange={handleOutputDate}
                    />
                  </>
                )}
              </Box>
              <TextField
                label="Version"
                select
                fullWidth
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                onChange={handleVersionChange}
              >
                {pricingData?.map((entry, index) => (
                  <option key={index} value={entry.yaml}>
                    {entry.yaml
                      .split('/')
                      // eslint-disable-next-line no-unexpected-multiline
                      [entry.yaml.split('/').length - 1].replace('.yaml', '')
                      .replace('.yml', ' ')}
                  </option>
                ))}
              </TextField>
            </Box>
          </Box>
        </Box>

        <Box display="flex" gap={4} sx={{ mb: 4 }}>
          {tabValue === 3 && pricingData && pricing && (
            <PricingSettings
              pricingName={pricing.saasName}
              pricingData={pricingData}
              updatePricingInformation={updatePricingInformation}
            />
          )}
          {tabValue === 2 && pricingData && <FileExplorer pricingData={pricingData} />}
          {tabValue === 1 && currentPricing && <ConfigurationSpaceView pricingId={currentPricing.id} />}
          {tabValue === 0 && (
            <>
              <Box flex={1} sx={{ maxWidth: '66.7%' }}>
                <Typography variant="h6" gutterBottom>
                  Pricing Information
                </Typography>
                <Typography variant="body1" sx={{ mb: 4 }}>
                  This is the pricing information for {pricing?.saasName}. The pricing version that
                  is currently displayed is from{' '}
                  {currentPricing?.extractionDate
                    ? new Date(currentPricing.extractionDate).toLocaleDateString()
                    : 'Unknown date'}
                  . The prices are displayed with {pricing?.currency} currency. In future versions,
                  more data will be provided in this card.
                </Typography>
                {rendererSource && <SpherePricingRenderer source={rendererSource} />}
              </Box>

              <Box sx={{ minWidth: '33.3%' }}>
                {currentPricing && pricing && (
                  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Stats currentPricing={currentPricing} pricing={pricing} />
                  </Paper>
                )}

                {pricingData && (
                  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                    <Analytics pricingData={pricingData} toggleModal={toggleModal} />
                  </Paper>
                )}
                {/* <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
              <Harvey />
            </Paper> */}

                <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
                  <PricingTree pricing={currentPricing} name={pricing?.saasName} />
                </Paper>
              </Box>
            </>
          )}
        </Box>
      </Container>

      <AnalyticsModal open={isModalOpen} onClose={toggleModal} pricingData={pricingData!} />
    </>
  );
}
