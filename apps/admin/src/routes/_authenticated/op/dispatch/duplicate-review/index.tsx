import { createFileRoute } from '@tanstack/react-router';
import { DuplicationReviewPage } from '@/features/dispatch/duplication-review';

export const Route = createFileRoute('/_authenticated/op/dispatch/duplicate-review/')({
  component: DuplicationReviewPage,
});
