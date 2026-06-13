import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiCheck, FiLoader, FiCamera, FiUpload, FiX, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import Cropper from 'react-easy-crop';
import { useUserSettingsApi, type UserSettings } from '../api/userSettingsApi';
import { useAuth } from '../../auth/hooks/useAuth';

interface Props {
  settings: UserSettings;
  onUpdate: (partial: Partial<UserSettings>) => void;
}

const COLOR_PRESETS = [
  '#fa520f', '#cc3a05', '#1f1f1f', '#ffffff', '#2c2c2c',
  '#4a4a4a', '#6a6a6a', '#a8a8a8', '#e5e5e5', '#fff8e0',
  '#ffd06a', '#ffb83e', '#ffa110', '#ff8105', '#ffd900',
];

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

const API_BASE = (import.meta.env.VITE_API_URL).replace("/api/v1", "");

async function fetchSvgWithColor(file: string, color: string): Promise<string> {
  const res = await fetch(`${API_BASE}/static/avatars/users/default/${file}`);
  let text = await res.text();
  text = text.replace(/currentColor/g, color);
  return `data:image/svg+xml;utf8,${encodeURIComponent(text)}`;
}

type AvatarMode = 'initials' | 'predefined' | 'upload';

function getAvatarMode(avatar?: string | null): AvatarMode {
  if (!avatar) return 'initials';
  if (avatar.includes('.svg')) return 'predefined';
  return 'upload';
}

function getSelectedSvgId(avatar?: string | null): string | null {
  if (!avatar || !avatar.includes('.svg')) return null;
  const match = SVG_AVATARS.find((v) => avatar.includes(v.file));
  return match?.id ?? null;
}

function resolveAvatarUrl(avatar: string): string {
  if (!avatar) return '';
  if (avatar.startsWith('http') || avatar.startsWith('data:')) return avatar;
  if (avatar.startsWith('/')) return `${API_BASE}${avatar}`;
  return `${API_BASE}/${avatar}`;
}

export default function AvatarEditor({ settings, onUpdate }: Props) {
  const api = useUserSettingsApi();
  const { updateUserSettings } = useAuth();

  const s = settings.settings;

  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(() => getAvatarMode(s?.avatar));
  const [bgColor, setBgColor] = useState(s?.avatarBgColor || '#fa520f');
  const [fgColor, setFgColor] = useState(s?.avatarFgColor || '#ffffff');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedSvgId, setSelectedSvgId] = useState<string | null>(() => getSelectedSvgId(s?.avatar));
  const [svgPage, setSvgPage] = useState(0);
  const [svgImages, setSvgImages] = useState<Record<string, string>>({});

  const [showCropModal, setShowCropModal] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixelCrop, setPixelCrop] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = `${settings.firstName?.[0] || ''}${settings.lastName?.[0] || ''}`.toUpperCase();

  const avatarSrc = s?.avatar
    ? s.avatar.startsWith('/') || s.avatar.startsWith('http')
      ? s.avatar
      : `${API_BASE}/${s.avatar}`
    : null;

  useEffect(() => {
    if (avatarMode !== 'predefined' && !showAvatarModal) return;
    const load = async () => {
      const entries: Record<string, string> = {};
      for (const svg of SVG_AVATARS) {
        entries[svg.id] = await fetchSvgWithColor(svg.file, fgColor);
      }
      setSvgImages(entries);
    };
    load();
  }, [avatarMode, showAvatarModal, fgColor]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be less than 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropImage(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixelCrop(null);
      setShowCropModal(true);
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const getCroppedImg = useCallback(async (imageSrc: string, pixelCropArea: { x: number; y: number; width: number; height: number }): Promise<Blob> => {
    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => { image.onload = resolve; });

    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, pixelCropArea.x, pixelCropArea.y, pixelCropArea.width, pixelCropArea.height, 0, 0, size, size);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      }, 'image/webp', 0.9);
    });
  }, []);

  const handleCropSave = useCallback(async () => {
    if (!cropImage || !pixelCrop) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await getCroppedImg(cropImage, pixelCrop);
      const file = new File([blob], 'avatar.webp', { type: 'image/webp' });
      const result = await api.uploadAvatar(file);
      updateUserSettings({ avatar: result.settings?.avatar || '' });
      setAvatarMode('upload');
      setShowCropModal(false);
      setCropImage(null);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [cropImage, pixelCrop, getCroppedImg, api, updateUserSettings]);

  const onCropComplete = useCallback((_croppedArea: any, croppedAreaPixels: { x: number; y: number; width: number; height: number }) => {
    setPixelCrop(croppedAreaPixels);
  }, []);

  const handleSaveAvatar = async () => {
    setUploading(true);
    setError(null);
    try {
      let avatarPath = '';
      if (avatarMode === 'predefined' && selectedSvgId) {
        const svgMeta = SVG_AVATARS.find((v) => v.id === selectedSvgId);
        if (svgMeta) avatarPath = `static/avatars/users/default/${svgMeta.file}`;
      }
      const result = await api.updateAvatarColors({
        avatarPath,
        avatarBgColor: bgColor,
        avatarFgColor: fgColor,
      });
      onUpdate(result);
      updateUserSettings({
        avatar: resolveAvatarUrl(result.settings?.avatar || avatarPath),
        avatarBgColor: bgColor,
        avatarFgColor: fgColor,
      });
      setShowAvatarModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save avatar');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setUploading(true);
    try {
      await api.removeAvatar();
      setAvatarMode('initials');
      setSelectedSvgId(null);
      updateUserSettings({ avatar: '' });
      setShowAvatarModal(false);
    } catch (err: any) {
      setError(err.message || 'Failed to remove avatar');
    } finally {
      setUploading(false);
    }
  };

  const paginatedSvgs = SVG_AVATARS.slice(svgPage * SVG_PAGE_SIZE, (svgPage + 1) * SVG_PAGE_SIZE);
  const totalSvgPages = Math.ceil(SVG_AVATARS.length / SVG_PAGE_SIZE);

  const renderPreview = () => {
    if (avatarMode === 'predefined' && selectedSvgId && svgImages[selectedSvgId]) {
      return (
        <div className="flex h-full w-full items-center justify-center" style={{ backgroundColor: bgColor }}>
          <img src={svgImages[selectedSvgId]} alt="" className="h-16 w-16 object-contain" />
        </div>
      );
    }
    if (avatarMode === 'upload' && avatarSrc) {
      return <img src={avatarSrc} alt="Avatar" className="h-full w-full object-cover" />;
    }
    return (
      <div className="flex h-full w-full items-center justify-center text-2xl font-bold" style={{ backgroundColor: bgColor, color: fgColor }}>
        {initials || '?'}
      </div>
    );
  };

  return (
    <>
      {/* Avatar preview button */}
      <div className="flex flex-col items-center">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={() => setShowAvatarModal(true)}
          className="group relative h-24 w-24 cursor-pointer overflow-hidden rounded-[12px] shadow-elevation-2 ring-2 ring-tp-hairline transition-shadow hover:ring-tp-primary"
        >
          {renderPreview()}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <FiCamera className="h-6 w-6 text-white" />
          </div>
        </motion.button>
        <p className="mt-2 text-xs text-tp-steel">Click to change avatar</p>
      </div>

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelect} />

      {/* Avatar Modal */}
      <AnimatePresence>
        {showAvatarModal && !showCropModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowAvatarModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="w-[90vw] max-w-150 overflow-hidden rounded-[12px] border border-tp-hairline bg-tp-canvas shadow-elevation-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-tp-hairline px-5 py-4">
                <h3 className="text-base font-medium text-tp-ink">Edit Avatar</h3>
                <button type="button" onClick={() => setShowAvatarModal(false)} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink">
                  <FiX className="h-4 w-4" />
                </button>
              </div>

              <div className="max-h-[70vh] overflow-y-auto p-5">
                <div className="space-y-5">
                  {/* Large preview */}
                  <div className="flex justify-center">
                    <div className="h-24 w-24 overflow-hidden rounded-[12px] ring-2 ring-tp-hairline">
                      {renderPreview()}
                    </div>
                  </div>

                  {/* Mode selector */}
                  <div>
                    <p className="mb-2 text-xs font-medium text-tp-steel">Options</p>
                    <div className="flex gap-2">
                      <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={() => { setAvatarMode('initials'); setSelectedSvgId(null); }} className={`flex cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-medium transition-colors ${avatarMode === 'initials' ? 'border-tp-primary bg-tp-primary/10 text-tp-primary' : 'border-tp-hairline-strong text-tp-ink hover:border-tp-hairline'}`}>
                        Initials
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={() => setAvatarMode('predefined')} className={`flex cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-medium transition-colors ${avatarMode === 'predefined' ? 'border-tp-primary bg-tp-primary/10 text-tp-primary' : 'border-tp-hairline-strong text-tp-ink hover:border-tp-hairline'}`}>
                        Predefined
                      </motion.button>
                      <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={() => fileInputRef.current?.click()} className={`flex cursor-pointer items-center gap-2 rounded-[6px] border px-3 py-2 text-xs font-medium transition-colors ${avatarMode === 'upload' ? 'border-tp-primary bg-tp-primary/10 text-tp-primary' : 'border-tp-hairline-strong text-tp-ink hover:border-tp-hairline'}`}>
                        <FiUpload className="h-3.5 w-3.5" />
                        Upload Image
                      </motion.button>
                    </div>
                  </div>

                  {/* Predefined SVG avatars */}
                  {avatarMode === 'predefined' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <p className="mb-2 text-xs font-medium text-tp-steel">Predefined Avatars</p>
                      <div className="grid grid-cols-5 gap-2.5">
                        {paginatedSvgs.map((svg) => {
                          const isSelected = selectedSvgId === svg.id;
                          return (
                            <motion.button key={svg.id} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} type="button" onClick={() => setSelectedSvgId(svg.id)} disabled={uploading} className={`flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-[8px] border-2 transition-colors ${isSelected ? 'border-tp-primary ring-1 ring-tp-primary/30' : 'border-tp-hairline hover:border-tp-hairline-strong'} ${uploading ? 'opacity-50' : ''}`} style={{ backgroundColor: bgColor }} title={svg.label}>
                                {svgImages[svg.id] ? (
                                  <img src={svgImages[svg.id]} alt={svg.label} className="h-10 w-10 object-contain" />
                                ) : (
                                  <div className="h-10 w-10 animate-pulse rounded bg-tp-surface" />
                                )}
                              </motion.button>
                          );
                        })}
                      </div>
                      {totalSvgPages > 1 && (
                        <div className="mt-3 flex items-center justify-center gap-2">
                          <button type="button" onClick={() => setSvgPage((p) => Math.max(0, p - 1))} disabled={svgPage === 0} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-tp-steel transition-colors hover:bg-tp-surface disabled:opacity-30">
                            <FiChevronLeft className="h-4 w-4" />
                          </button>
                          <span className="text-xs text-tp-steel">{svgPage + 1} / {totalSvgPages}</span>
                          <button type="button" onClick={() => setSvgPage((p) => Math.min(totalSvgPages - 1, p + 1))} disabled={svgPage >= totalSvgPages - 1} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-tp-steel transition-colors hover:bg-tp-surface disabled:opacity-30">
                            <FiChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Color pickers */}
                  <div className="space-y-3">
                    <div>
                      <p className="mb-2 text-xs font-medium text-tp-steel">Background Color</p>
                      <div className="flex flex-wrap gap-2">
                        {COLOR_PRESETS.map((c) => (
                          <button key={`bg-${c}`} type="button" onClick={() => setBgColor(c)} className={`h-7 w-7 cursor-pointer rounded-full border transition-transform hover:scale-110 ${bgColor === c ? 'border-0 ring-2 ring-tp-primary ring-offset-2 ring-offset-tp-canvas' : 'border-tp-hairline'}`} style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium text-tp-steel">{avatarMode === 'predefined' ? 'Icon Color' : 'Text Color'}</p>
                      <div className="flex flex-wrap gap-2">
                        {COLOR_PRESETS.map((c) => (
                          <button key={`fg-${c}`} type="button" onClick={() => setFgColor(c)} className={`h-7 w-7 cursor-pointer rounded-full border transition-transform hover:scale-110 ${fgColor === c ? 'border-0 ring-2 ring-tp-primary ring-offset-2 ring-offset-tp-canvas' : 'border-tp-hairline'}`} style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  {error && <p className="text-sm text-red-500">{error}</p>}

                  {/* Actions */}
                  <div className="flex justify-between border-t border-tp-hairline pt-4">
                    {s?.avatar && (
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={handleRemoveAvatar} disabled={uploading} className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-red-300 px-4 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40">
                        Remove Avatar
                      </motion.button>
                    )}
                    <div className="flex gap-2 ml-auto">
                      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={() => setShowAvatarModal(false)} className="cursor-pointer rounded-[8px] px-4 py-2.5 text-sm font-medium text-tp-steel transition-colors hover:text-tp-ink">
                        Cancel
                      </motion.button>
                      {avatarMode !== 'upload' && (
                        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={handleSaveAvatar} disabled={uploading} className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary disabled:opacity-40">
                          {uploading ? <FiLoader className="h-4 w-4 animate-spin" /> : <FiCheck className="h-4 w-4" />}
                          Save Avatar
                        </motion.button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Crop Modal */}
      <AnimatePresence>
        {showCropModal && cropImage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => { setShowCropModal(false); setCropImage(null); }}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} className="w-[90vw] max-w-150 overflow-hidden rounded-[12px] border border-tp-hairline bg-tp-canvas shadow-elevation-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-tp-hairline px-5 py-4">
                <h3 className="text-base font-medium text-tp-ink">Crop Avatar</h3>
                <button type="button" onClick={() => { setShowCropModal(false); setCropImage(null); }} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-tp-steel transition-colors hover:bg-tp-surface hover:text-tp-ink">
                  <FiX className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                <div className="relative h-72 w-full overflow-hidden rounded-[8px] bg-tp-surface">
                  <Cropper image={cropImage} crop={crop} zoom={zoom} aspect={1} cropShape="rect" onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
                </div>
                <div className="mt-4 space-y-2">
                  <label className="text-xs font-medium text-tp-steel">Zoom</label>
                  <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full cursor-pointer accent-tp-primary" />
                </div>
                {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={() => { setShowCropModal(false); setCropImage(null); }} className="cursor-pointer rounded-[8px] px-4 py-2.5 text-sm font-medium text-tp-steel transition-colors hover:text-tp-ink">
                    Back
                  </motion.button>
                  <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} type="button" onClick={handleCropSave} disabled={uploading || !pixelCrop} className="flex cursor-pointer items-center gap-2 rounded-[8px] bg-tp-primary px-4 py-2.5 text-sm font-medium text-tp-on-primary disabled:opacity-40">
                    {uploading ? <FiLoader className="h-4 w-4 animate-spin" /> : <FiCheck className="h-4 w-4" />}
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
