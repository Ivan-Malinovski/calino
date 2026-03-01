import type { JSX } from 'react';
import { useState, useCallback, useEffect, useRef } from 'react';
import { format, isValid } from 'date-fns';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { parseNaturalLanguage, type NLPParseResult } from '../index';
import styles from './QuickAdd.module.css';

export interface QuickAddProps {
  onAdd: (result: NLPParseResult) => void;
  onCancel?: () => void;
}

export function QuickAdd({ onAdd, onCancel }: QuickAddProps): JSX.Element {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<NLPParseResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parseInput = useCallback((text: string) => {
    if (!text.trim()) {
      setPreview(null);
      return;
    }

    const result = parseNaturalLanguage(text);
    setPreview(result);
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      parseInput(input);
    }, 150);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [input, parseInput]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (preview) {
      onAdd(preview);
      setInput('');
      setPreview(null);
    }
  }, [preview, onAdd]);

  const handleCancel = useCallback(() => {
    setInput('');
    setPreview(null);
    onCancel?.();
  }, [onCancel]);

  const formatDate = (date: Date): string => {
    if (!isValid(date)) return 'Invalid date';
    return format(date, 'EEEE, MMMM d, yyyy');
  };

  const formatTime = (date: Date): string => {
    if (!isValid(date)) return '';
    return format(date, 'h:mm a');
  };

  return (
    <form className={styles.container} onSubmit={handleSubmit}>
      <div className={styles.inputWrapper}>
        <Input
          type="text"
          placeholder="Add event: 'Meeting tomorrow at 2pm for 1 hour'"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
      </div>

      {preview && (
        <div className={styles.preview}>
          <div className={styles.previewTitle}>
            {preview.title}
          </div>
          <div className={styles.previewDetails}>
            <div className={styles.previewRow}>
              <span className={styles.previewLabel}>Date:</span>
              <span>{formatDate(preview.startDate)}</span>
            </div>
            {!preview.isAllDay && preview.startDate && (
              <div className={styles.previewRow}>
                <span className={styles.previewLabel}>Time:</span>
                <span>
                  {formatTime(preview.startDate)}
                  {preview.endDate && ` - ${formatTime(preview.endDate)}`}
                </span>
              </div>
            )}
            {preview.isAllDay && (
              <div className={styles.previewRow}>
                <span className={styles.previewLabel}>Type:</span>
                <span>All day</span>
              </div>
            )}
            {preview.location && (
              <div className={styles.previewRow}>
                <span className={styles.previewLabel}>Location:</span>
                <span>{preview.location}</span>
              </div>
            )}
            {preview.recurrence && (
              <div className={styles.previewRow}>
                <span className={styles.previewLabel}>Repeats:</span>
                <span>{preview.recurrence.frequency}</span>
              </div>
            )}
            <div className={styles.confidence}>
              <span>Confidence:</span>
              <div className={styles.confidenceBar}>
                <div
                  className={styles.confidenceFill}
                  style={{ width: `${preview.confidence * 100}%` }}
                />
              </div>
              <span>{Math.round(preview.confidence * 100)}%</span>
            </div>
          </div>
        </div>
      )}

      {input && !preview && (
        <div className={styles.preview}>
          <span className={styles.empty}>Press Enter to add event without parsing</span>
        </div>
      )}

      <div className={styles.actions}>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!preview}>
          Add Event
        </Button>
      </div>
    </form>
  );
}
