import { Badge } from '../ui/Primitives';
import type { SessionQuestion } from '../../types';

/**
 * The answer control for one question: multiple choice, true/false or a short
 * open answer. Big touch targets, real radios (keyboard and screen readers just
 * work) and a label for every control.
 *
 * `correctAnswer` and `chosen` are only passed once feedback is allowed; while a
 * test runs they are never set, so nothing here can hint at the solution.
 */
export function QuestionInput({
  question,
  value,
  onChange,
  disabled,
  correctAnswer,
}: {
  question: SessionQuestion;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Shown after feedback: marks the right option. */
  correctAnswer?: string;
}) {
  const name = `question-${question.id}`;

  if (question.questionType === 'short_answer') {
    return (
      <label className="field session-open-answer">
        <span>Your answer</span>
        <textarea
          className="textarea"
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder="Write it in your own words…"
        />
      </label>
    );
  }

  const options =
    question.options && question.options.length > 0
      ? question.options
      : question.questionType === 'true_false'
        ? ['True', 'False']
        : [];

  return (
    <fieldset className="session-options" disabled={disabled}>
      <legend className="visually-hidden">
        {question.questionType === 'true_false' ? 'True or false' : 'Choose an answer'}
      </legend>
      {options.map((option) => {
        const selected = value === option;
        const isCorrect = correctAnswer !== undefined && correctAnswer === option;
        const isWrongChoice = correctAnswer !== undefined && selected && !isCorrect;
        return (
          <label
            key={option}
            className={`session-option${selected ? ' is-selected' : ''}${
              isCorrect ? ' is-correct' : ''
            }${isWrongChoice ? ' is-wrong' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={selected}
              onChange={() => onChange(option)}
            />
            <span className="session-option-text">{option}</span>
            {isCorrect ? <Badge variant="accent">Correct answer</Badge> : null}
            {isWrongChoice ? <Badge variant="danger">Your answer</Badge> : null}
          </label>
        );
      })}
    </fieldset>
  );
}
