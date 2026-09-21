import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Cropper from 'react-easy-crop';
import { FiCheck, FiChevronLeft, FiChevronRight, FiLoader, FiUpload, FiX } from 'react-icons/fi';
import { Organization, useOrganizationsApi } from '../../../api/organizationsApi';

interface Props {
  org: Organization;
  onClose: () => void;
  onSaved: (updated: Organization) => void;
}

const COLOR_PRESETS = [
  '#023e8a', '#fa520f', '#cc3a05', '#1f1f1f', '#ffffff',
  '#2c2c2c', '#4a4a4a', '#6a6a6a', '#a8a8a8', '#e5e5e5',
  '#fff8e0', '#ffd06a', '#ffb83e', '#ffa110', '#ffd900',
];

// The same predefined set the user avatar editor offers; they are the only SVGs
// the API accepts, and the allow-list lives in `api/src/main/config/defaultAvatars.ts`.
const SVG_AVATAR_FOLDER = 'static/avatars/users/default';
const SVG_AVATARS = [
  { id: 'avatar-1', file: 'avatar-1.svg', label: 'Bear' },
  { id: 'avatar-2', file: 'avatar-2.svg', label: 'Cat' },
  { id: 'avatar-3', file: 'avatar-3.svg', label: 'Ghost' },
  { id: 'avatar-4', file: 'avatar-4.svg', label: 'Owl' },
  { id: 'avatar-6', file: 'avatar-6.svg', label: 'Bird' },
  { id: 'avatar-7', file: 'avatar-7.svg', label: 'Skull' },
  { id: 'avatar-8', file: 'avatar-8.svg', label: 'Alien' },
  { id: 'avatar-9', file: 'avatar-9.svg', label: 'Robot' },
  { id: 'avatar-10', file: 'avatar-10.svg', label: 'Dog' },
];

const SVG_PAGE_SIZE = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const OUTPUT_SIZE = 256;

const API_BASE = import.meta.env.VITE_API_URL.replace('/api/v1', '');

type AvatarMode = 'initials' | 'predefined' | 'upload';
type PixelCrop = { x: number; y: number; width: number; height: number };

function getAvatarMode(avatar?: string | null): AvatarMode {
  if (!avatar) return 'initials';
  if (avatar.includes('.svg')) return 'predefined';
  return 'upload';
}

function getSelectedSvgId(avatar?: string | null): string | null {
  if (!avatar || !avatar.includes('.svg')) return null;
  return SVG_AVATARS.find(svg => avatar.includes(svg.file))?.id ?? null;
}

function getInitials(name: string): string {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The predefined avatars are drawn with `currentColor`, so one file serves every colour. */
async function fetchSvgWithColor(file: string, color: string): Promise<string> {
  const response = await fetch(`${API_BASE}/${SVG_AVATAR_FOLDER}/${file}`);
  const text = (await response.text()).replace(/currentColor/g, color);
  return `data:image/svg+xml;utf8,${encodeURIComponent(text)}`;
}

/**
 * Draws the selected region onto a fixed-size square canvas, so the API stores
 * one small predictable image whatever the original was.
 */
async function cropToSquare(imageSrc: string, area: PixelCrop): Promise<Blob> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('That file could not be read as an image'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the image');

  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Could not prepare the image'))),
      'image/webp',
      0.9
    );
  });
}

/**
 * Changes the image an organization is shown with.
 *
 * Deliberately the same editor as the one under profile settings: initials,
 * one of the predefined avatars, or an uploaded image, each over a colour of
 * the organization's choosing.
 */
export default function OrgAvatarModal({ org, onClose, onSaved }: Props) {
  const { uploadOrgAvatar, updateOrgAvatarColors, removeOrgAvatar } = useOrganizationsApi();

  const [avatarMode, setAvatarMode] = useState<AvatarMode>(() => getAvatarMode(org.avatar));
  const [selectedSvgId, setSelectedSvgId] = useState<string | null>(() =>
    getSelectedSvgId(org.avatar)
  );
  const [bgColor, setBgColor] = useState(org.avatarBgColor || '#023e8a');
  const [fgColor, setFgColor] = useState(org.avatarFgColor || '#ffffff');

  const [svgPage, setSvgPage] = useState(0);
  const [svgImages, setSvgImages] = useState<Record<string, string>>({});

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixelCrop, setPixelCrop] = useState<PixelCrop | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const initials = getInitials(org.displayName);

  useEffect(() => {
    let isCurrent = true;
    Promise.all(
      SVG_AVATARS.map(svg =>
        fetchSvgWithColor(svg.file, fgColor).then(uri => [svg.id, uri] as const)
      )
    )
      .then(entries => {
        if (isCurrent) setSvgImages(Object.fromEntries(entries));
      })
      .catch(() => {
        /* The grid falls back to its loading blocks. */
      });
    return () => {
      isCurrent = false;
    };
  }, [fgColor]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing the input lets the same file be picked again after a cancel,
    // which otherwise fires no change event at all.
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError('The image must be smaller than 2MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCropImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixelCrop(null);
      setError(null);
    };
    reader.onerror = () => setError('That file could not be read');
    reader.readAsDataURL(file);
  };

  const handleCropSave = useCallback(async () => {
    if (!cropImage || !pixelCrop) return;
    setIsSaving(true);
    setError(null);
    try {
      const blob = await cropToSquare(cropImage, pixelCrop);
      const updated = await uploadOrgAvatar(
        org.id,
        new File([blob], 'avatar.webp', { type: 'image/webp' }),
        { avatarBgColor: bgColor, avatarFgColor: fgColor }
      );
      onSaved(updated);
      onClose();
    } catch (err) {
      setError((err as Error)?.message || 'The image could not be saved');
      setIsSaving(false);
    }
  }, [cropImage, pixelCrop, uploadOrgAvatar, org.id, bgColor, fgColor, onSaved, onClose]);

  const handleSaveAvatar = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      let avatarPath = '';
      if (avatarMode === 'predefined' && selectedSvgId) {
        const svg = SVG_AVATARS.find(candidate => candidate.id === selectedSvgId);
        if (svg) avatarPath = `${SVG_AVATAR_FOLDER}/${svg.file}`;
      }
      const updated = await updateOrgAvatarColors(org.id, {
        avatarPath,
        avatarBgColor: bgColor,
        avatarFgColor: fgColor,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError((err as Error)?.message || 'The avatar could not be saved');
      setIsSaving(false);
    }
  }, [avatarMode, selectedSvgId, updateOrgAvatarColors, org.id, bgColor, fgColor, onSaved, onClose]);

  const handleRemoveAvatar = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const updated = await removeOrgAvatar(org.id);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError((err as Error)?.message || 'The avatar could not be removed');
      setIsSaving(false);
    }
  }, [removeOrgAvatar, org.id, onSaved, onClose]);

  const paginatedSvgs = SVG_AVATARS.slice(svgPage * SVG_PAGE_SIZE, (svgPage + 1) * SVG_PAGE_SIZE);
  const totalSvgPages = Math.ceil(SVG_AVATARS.length / SVG_PAGE_SIZE);

  const renderPreview = () => {
    if (avatarMode === 'predefined' && selectedSvgId && svgImages[selectedSvgId]) {
      return (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ backgroundColor: bgColor }}
        >
          <img src={svgImages[selectedSvgId]} alt="" className="h-16 w-16 object-contain" />
        </div>
      );
    }
    if (avatarMode === 'upload' && org.avatar) {
      return <img src={org.avatar} alt={org.displayName} className="h-full w-full object-cover" />;
    }
    return (
      <div
        className="flex h-full w-full items-center justify-center text-2xl font-bold"
        style={{ backgroundColor: bgColor, color: fgColor }}
      >
        {initials}
      </div>
    );
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Avatar modal */}
      {!cropImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="w-[90vw] max-w-150 overflow-hidden rounded-[12px] border border-tp-hairline bg-tp-canvas shadow-elevation-4"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-tp-hairline px-5 py-4">
              <h3 className="text-base font-medium text-tp-ink">Edit Organization Image</h3>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
              >
                <FiX className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              <div className="space-y-5">
                <div className="flex justify-center">
                  <div className="h-24 w-24 overflow-hidden rounded-[12px] ring-2 ring-tp-hairline">
                    {renderPreview()}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-tp-steel">Options</p>
                  <div className="flex gap-2">
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => {
                        setAvatarMode('initials');
                        setSelectedSvgId(null);
                      }}
                      className={`flex cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-medium transition-colors ${
                        avatarMode === 'initials'
                          ? 'border-tp-primary bg-tp-primary/10 text-tp-primary'
                          : 'border-tp-hairline-strong text-tp-ink hover:border-tp-hairline'
                      }`}
                    >
                      Initials
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => setAvatarMode('predefined')}
                      className={`flex cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-medium transition-colors ${
                        avatarMode === 'predefined'
                          ? 'border-tp-primary bg-tp-primary/10 text-tp-primary'
                          : 'border-tp-hairline-strong text-tp-ink hover:border-tp-hairline'
                      }`}
                    >
                      Predefined
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-medium transition-colors ${
                        avatarMode === 'upload'
                          ? 'border-tp-primary bg-tp-primary/10 text-tp-primary'
                          : 'border-tp-hairline-strong text-tp-ink hover:border-tp-hairline'
                      }`}
                    >
                      <FiUpload className="h-3.5 w-3.5" />
                      Upload Image
                    </motion.button>
                  </div>
                </div>

                {avatarMode === 'predefined' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <p className="mb-2 text-xs font-medium text-tp-steel">Predefined Avatars</p>
                    <div className="grid grid-cols-5 gap-2.5">
                      {paginatedSvgs.map(svg => {
                        const isSelected = selectedSvgId === svg.id;
                        return (
                          <motion.button
                            key={svg.id}
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            type="button"
                            onClick={() => setSelectedSvgId(svg.id)}
                            disabled={isSaving}
                            title={svg.label}
                            style={{ backgroundColor: bgColor }}
                            className={`flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border-2 transition-colors ${
                              isSelected
                                ? 'border-tp-primary ring-1 ring-tp-primary/30'
                                : 'border-tp-hairline hover:border-tp-hairline-strong'
                            } ${isSaving ? 'opacity-50' : ''}`}
                          >
                            {svgImages[svg.id] ? (
                              <img
                                src={svgImages[svg.id]}
                                alt={svg.label}
                                className="h-10 w-10 object-contain"
                              />
                            ) : (
                              <div className="h-10 w-10 animate-pulse rounded bg-tp-surface" />
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                    {totalSvgPages > 1 && (
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSvgPage(page => Math.max(0, page - 1))}
                          disabled={svgPage === 0}
                          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-tp-steel transition-colors hover:bg-tp-surface disabled:opacity-30"
                        >
                          <FiChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-xs text-tp-steel">
                          {svgPage + 1} / {totalSvgPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSvgPage(page => Math.min(totalSvgPages - 1, page + 1))}
                          disabled={svgPage >= totalSvgPages - 1}
                          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-tp-steel transition-colors hover:bg-tp-surface disabled:opacity-30"
                        >
                          <FiChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}

                <div className="space-y-3">
                  <div>
                    <p className="mb-2 text-xs font-medium text-tp-steel">Background Color</p>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_PRESETS.map(color => (
                        <button
                          key={`bg-${color}`}
                          type="button"
                          onClick={() => setBgColor(color)}
                          style={{ backgroundColor: color }}
                          className={`h-7 w-7 cursor-pointer rounded-full border transition-transform hover:scale-110 ${
                            bgColor === color
                              ? 'border-0 ring-2 ring-tp-primary ring-offset-2 ring-offset-tp-canvas'
                              : 'border-tp-hairline'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-tp-steel">
                      {avatarMode === 'predefined' ? 'Icon Color' : 'Text Color'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_PRESETS.map(color => (
                        <button
                          key={`fg-${color}`}
                          type="button"
                          onClick={() => setFgColor(color)}
                          style={{ backgroundColor: color }}
                          className={`h-7 w-7 cursor-pointer rounded-full border transition-transform hover:scale-110 ${
                            fgColor === color
                              ? 'border-0 ring-2 ring-tp-primary ring-offset-2 ring-offset-tp-canvas'
                              : 'border-tp-hairline'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}

                <div className="flex justify-between border-t border-tp-hairline pt-4">
                  {org.avatar && (
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={handleRemoveAvatar}
                      disabled={isSaving}
                      className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-red-300 px-4 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Remove Image
                    </motion.button>
                  )}
                  <div className="ml-auto flex gap-2">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="button"
                      onClick={onClose}
                      className="cursor-pointer rounded-[8px] px-4 py-2.5 text-sm font-medium text-tp-steel transition-colors hover:text-tp-ink"
                    >
                      Cancel
                    </motion.button>
                    {avatarMode !== 'upload' && (
                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="button"
                        onClick={handleSaveAvatar}
                        disabled={isSaving}
                        className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary disabled:opacity-40"
                      >
                        {isSaving ? (
                          <FiLoader className="h-4 w-4 animate-spin" />
                        ) : (
                          <FiCheck className="h-4 w-4" />
                        )}
                        Save Image
                      </motion.button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* Crop modal */}
      <AnimatePresence>
        {cropImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={() => setCropImage(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="w-[90vw] max-w-150 overflow-hidden rounded-[12px] border border-tp-hairline bg-tp-canvas shadow-elevation-4"
              onClick={event => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-tp-hairline px-5 py-4">
                <h3 className="text-base font-medium text-tp-ink">Crop Image</h3>
                <button
                  type="button"
                  onClick={() => setCropImage(null)}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink"
                >
                  <FiX className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                <div className="relative h-72 w-full overflow-hidden rounded-[8px] bg-tp-surface">
                  <Cropper
                    image={cropImage}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    cropShape="rect"
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={(_area, areaPixels) => setPixelCrop(areaPixels)}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <label className="text-xs font-medium text-tp-steel">Zoom</label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.1}
                    value={zoom}
                    onChange={event => setZoom(Number(event.target.value))}
                    className="w-full cursor-pointer accent-tp-primary"
                  />
                </div>
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={() => setCropImage(null)}
                    className="cursor-pointer rounded-[8px] px-4 py-2.5 text-sm font-medium text-tp-steel transition-colors hover:text-tp-ink"
                  >
                    Back
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="button"
                    onClick={handleCropSave}
                    disabled={isSaving || !pixelCrop}
                    className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary disabled:opacity-40"
                  >
                    {isSaving ? (
                      <FiLoader className="h-4 w-4 animate-spin" />
                    ) : (
                      <FiCheck className="h-4 w-4" />
                    )}
                    Save
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
