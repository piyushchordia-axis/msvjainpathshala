import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="size-7 text-muted-foreground" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-secondary">Page not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This page doesn't exist — it may have moved or been deleted.
            </p>
          </div>
          <Button asChild variant="default">
            <Link href="/">Back to home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
