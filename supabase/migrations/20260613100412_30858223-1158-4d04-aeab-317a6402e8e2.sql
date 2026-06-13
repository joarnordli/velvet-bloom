DROP POLICY IF EXISTS "Targets can approve pending follow requests" ON public.follows;
CREATE POLICY "Targets can approve pending follow requests"
ON public.follows
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = following_id
  AND EXISTS (
    SELECT 1
    FROM public.follow_requests fr
    WHERE fr.requester_id = follows.follower_id
      AND fr.target_id = follows.following_id
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notifications_unique_pending_follow_request
ON public.notifications (recipient_id, actor_id, type)
WHERE type = 'follow_request';