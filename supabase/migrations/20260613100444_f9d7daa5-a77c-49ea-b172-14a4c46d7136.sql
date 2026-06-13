CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.follower_id = NEW.following_id THEN
    RETURN NEW;
  END IF;

  -- If this follow was created by approving a private-account request,
  -- the profile owner already saw the request and should not get a second
  -- "started following" notification for the same action.
  IF EXISTS (
    SELECT 1
    FROM public.follow_requests fr
    WHERE fr.requester_id = NEW.follower_id
      AND fr.target_id = NEW.following_id
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_id, actor_id, type)
  VALUES (NEW.following_id, NEW.follower_id, 'follow');
  RETURN NEW;
END $$;