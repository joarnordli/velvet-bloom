
-- Path layout: {conversation_id}/{uuid}.{ext}
-- storage.foldername(name)[1] = conversation_id

CREATE POLICY mm_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'message-media'
    AND public.is_conversation_member(
      (storage.foldername(name))[1]::uuid,
      auth.uid()
    )
  );

CREATE POLICY mm_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'message-media'
    AND public.is_conversation_member(
      (storage.foldername(name))[1]::uuid,
      auth.uid()
    )
  );

CREATE POLICY mm_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'message-media'
    AND owner = auth.uid()
  );
