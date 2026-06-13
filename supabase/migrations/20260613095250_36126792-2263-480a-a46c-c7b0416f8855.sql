-- Allow actor to insert their own notifications (covers follow_request and follow_accept,
-- which are written by server functions running as the acting user; trigger-based notifications
-- are unaffected because they run as SECURITY DEFINER).
CREATE POLICY "actor can insert own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (actor_id = auth.uid() AND actor_id <> recipient_id);