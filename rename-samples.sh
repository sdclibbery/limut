echo $1
cd $1
a=1
for i in *.wav; do
  new=$(printf "%02d.wav" "$a")
  echo "rename $i to $new"
  mv -i -- "$i" "$new"
  let a=a+1
done
cd -
