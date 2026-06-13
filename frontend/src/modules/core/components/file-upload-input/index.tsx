import { useState, useCallback } from 'react';
import { FaUpload } from 'react-icons/fa';
import { Accept, useDropzone } from 'react-dropzone';
import { MdDeleteForever } from 'react-icons/md';
import { error } from '../../theme/palette';
import customAlert from '../../utils/custom-alert';
import ActionButton from '../action-button';

export default function FileUpload({
  onSubmit,
  submitButtonText,
  submitButtonWidth,
  isDragActiveText,
  isNotDragActiveText,
  accept,
  disabled,
}: {
  onSubmit: (file: File) => void;
  submitButtonText?: string;
  submitButtonWidth?: number;
  isDragActiveText?: string;
  isNotDragActiveText?: string;
  accept?: Accept;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const uploadedFile = acceptedFiles[0];
    const extensionValidator = accept
      ? Object.values(accept).every(extensions =>
          extensions.some(ext => uploadedFile.name.endsWith(ext))
        )
      : uploadedFile.name.endsWith('.yaml') || uploadedFile.name.endsWith('.yml');
      
    if (uploadedFile && extensionValidator) {
      setFile(uploadedFile);
    } else {
      customAlert('Please upload a file with a .yaml or .yml extension', 'warning');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: accept ?? {
      'application/x-yaml': ['.yaml', '.yml'],
    },
    maxFiles: 1,
    multiple: false,
  });

  const handleDelete = () => {
    setFile(null);
  };

  const handleSubmit = () => {
    // set editor's value with the contents of the file as a string

    if (!file) {
      return;
    }

    onSubmit(file);
    handleDelete();
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="my-2 w-full">
        <div
          {...getRootProps()}
          className={`border-2 border-dashed border-[#ccc] bg-white p-[10px] text-center transition-colors hover:bg-[#f0f0f0] ${file ? 'pointer-events-none opacity-50' : 'cursor-pointer opacity-100'}`}
          role="button"
          tabIndex={0}
        >
          <input {...getInputProps()} type="file" className="hidden" />
          <FaUpload className="mx-auto mb-4 block text-5xl" />
          <h3 className="mb-2 mt-4 text-xl font-semibold text-sphere-grey-900">
            {isDragActive
              ? isDragActiveText
                ? isDragActiveText
                : 'Drop the Pricing2Yaml file here'
              : isNotDragActiveText
              ? isNotDragActiveText
              : 'Drag and drop a Pricing2Yaml file here'}
          </h3>
          <p className="text-sm text-sphere-grey-600">
            or click to select a file
          </p>
        </div>

        {file && (
          <ul className="mt-3 divide-y divide-sphere-grey-300 rounded-md border border-sphere-grey-300">
            <li className="flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-sm font-medium text-sphere-grey-900">{file.name}</p>
                <p className="text-xs text-sphere-grey-600">{`${(file.size / 1024).toFixed(2)} KB`}</p>
              </div>
              <button type="button" aria-label="delete" onClick={handleDelete} className="cursor-pointer">
                <MdDeleteForever size={25} fill={error.dark} />
              </button>
            </li>
          </ul>
        )}
      </div>
      <ActionButton text={submitButtonText ?? 'Submit file'} onClick={handleSubmit} disabled={!file || disabled} className={`mt-5 font-bold ${submitButtonWidth ? 'w-auto' : 'w-full'}`}/>
    </div>
  );
}
