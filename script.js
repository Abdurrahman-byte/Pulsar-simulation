const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:false});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
const scene=new THREE.Scene();
const cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const quad=new THREE.PlaneGeometry(2,2);

// ===================== MAIN SCENE SHADER =====================
// Ray marches: (1) mildly-lensed neutron-star surface, (2) volumetric
// magnetosphere jets/beams along the tilted (oblique-rotator) magnetic
// axis with helical pulsar-wind twist + relativistic Doppler boosting,
// (3) analytic dipole field-line shells r = L*sin^2(theta), (4) starfield.
const frag=`
precision highp float;
uniform vec2 uRes; uniform float uTime,uSpin,uTilt,uJet,uOpen;
uniform vec3 uCamPos; uniform mat3 uCamBasis;
#define PI 3.14159265
#define TAU 6.2831853

float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float vnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
 float a=hash13(i),b=hash13(i+vec3(1,0,0)),c=hash13(i+vec3(0,1,0)),d=hash13(i+vec3(1,1,0));
 float e=hash13(i+vec3(0,0,1)),g=hash13(i+vec3(1,0,1)),h=hash13(i+vec3(0,1,1)),k=hash13(i+vec3(1,1,1));
 return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(h,k,f.x),f.y),f.z);}
float fbm(vec3 p){float s=0.0,a=0.5;for(int i=0;i<5;i++){s+=a*vnoise(p);p*=2.05;a*=0.5;}return s;}
vec3 starfield(vec3 d){
 vec2 uv=vec2(atan(d.z,d.x)/TAU,acos(clamp(d.y,-1.0,1.0))/PI); vec2 gv=uv*vec2(900.0,450.0);
 vec2 id=floor(gv),fv=fract(gv)-0.5; float hh=hash13(vec3(id,7.0));
 float st=step(0.987,hh)*smoothstep(0.5,0.0,length(fv));
 return vec3(st)*mix(vec3(1.0,0.85,0.7),vec3(0.7,0.85,1.0),hh)+0.02*vec3(0.2,0.3,0.7)*fbm(d*2.0);
}

// Weak relativistic lensing near the star's compact surface: same geodesic
// acceleration form as a Schwarzschild ray (a = -1.5*h^2*r/r^5) but with a
// small "compactness" so bending is mild -- stylized, not exact GR, but it
// is the correct qualitative reason a compact star's near side wraps
// slightly past its geometric limb.
vec3 bendStep(vec3 p, vec3 v, float h2, float dl){
  float r=length(p);
  vec3 a=-1.2*h2*p/pow(max(r,0.05),5.0);
  return v+dl*a;
}

void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;
  vec3 dir=normalize(uCamBasis*normalize(vec3(uv,1.6)));
  vec3 pos=uCamPos, vel=dir;
  vec3 hvec=cross(pos,vel); float h2=dot(hvec,hvec)*0.06; // scaled down: neutron star, not a black hole

  float tiltRad=radians(uTilt), phase=uTime*uSpin;
  vec3 magAxis=normalize(vec3(sin(tiltRad)*cos(phase), cos(tiltRad), sin(tiltRad)*sin(phase)));
  float openRad=radians(uOpen);
  float starR=1.0, jetMax=9.0;

  vec3 accum=vec3(0.0); float trans=1.0; bool hitStar=false;

  for(int i=0;i<140;i++){
    float r=length(pos);
    if(r>40.0) break;
    float dl=clamp(0.05*r+0.01,0.015,0.5);
    vel=bendStep(pos,vel,h2,dl);
    vec3 newPos=pos+dl*vel;

    // --- neutron star surface hit (sphere test on the bent path) ---
    if(length(newPos)<starR){
      vec3 n=normalize(pos);
      float rim=pow(1.0-max(dot(n,normalize(uCamPos-pos)),0.0),2.5); // fresnel rim darkening/brighten
      float quake=fbm(n*8.0+uTime*0.05);
      float polar=pow(max(dot(n,magAxis),0.0),6.0)+pow(max(dot(n,-magAxis),0.0),6.0); // polar-cap hotspots
      vec3 base=mix(vec3(0.5,0.6,0.9), vec3(1.0,0.95,0.9), quake);
      vec3 surf=base*(0.5+0.5*rim) + vec3(1.4,1.6,2.0)*polar;
      accum += trans*surf; trans=0.0; hitStar=true; break;
    }

    // --- volumetric jet / relativistic beam accumulation ---
    float rr=length(newPos);
    if(rr>starR*1.02 && rr<jetMax){
      float cosA=dot(normalize(newPos),magAxis);
      float ang=acos(clamp(abs(cosA),0.0,1.0));
      if(ang<openRad*1.4){
        float coneFall=smoothstep(openRad*1.4,0.0,ang);
        // helical twist from the rotating pulsar wind (frozen-in field sweep)
        float along=rr;
        vec3 axis2=(cosA>=0.0)?magAxis:-magAxis;
        vec3 perp1=normalize(cross(axis2, vec3(0.0,1.0,0.001)));
        vec3 perp2=cross(axis2,perp1);
        float twist=along*0.9-uTime*uSpin*1.3;
        vec3 samp=vec3(dot(newPos,perp1)*cos(twist)-dot(newPos,perp2)*sin(twist),
                        dot(newPos,perp1)*sin(twist)+dot(newPos,perp2)*cos(twist), along*0.6);
        float density=fbm(samp*1.6)*coneFall;
        density*=smoothstep(starR,starR*1.4,rr)*smoothstep(jetMax,jetMax*0.55,rr);

        // relativistic Doppler boosting of the outflowing synchrotron beam
        float beta=0.92, gamma=1.0/sqrt(1.0-beta*beta);
        vec3 toObs=normalize(-vel);
        float costh=dot(axis2,toObs);
        float doppler=1.0/(gamma*(1.0-beta*costh));
        float boost=pow(clamp(doppler,0.05,4.0),3.0);
        vec3 shift=mix(vec3(1.3,0.4,0.3), vec3(0.7,0.85,1.6), clamp((doppler-0.4)/1.8,0.0,1.0));
        vec3 synchro=mix(vec3(0.5,0.7,1.5), vec3(1.6,1.7,2.0), density); // blue-white -> harder UV-ish core

        float shock=smoothstep(jetMax*0.9,jetMax,rr)*3.0; // termination shock brightening
        vec3 emission=(synchro*shift*density*boost*uJet)+vec3(0.9,1.0,1.4)*shock*coneFall;
        float op=clamp(density*0.9,0.0,1.0);
        accum+=trans*emission*op; trans*=(1.0-op*0.7);
      }
    }

    // --- analytic dipole field-line shells: r = L*sin^2(theta) ---
    {
      float ct=dot(normalize(newPos),magAxis);
      float s2=max(1.0-ct*ct,0.0004);
      float L=rr/s2;
      float Lm=mod(L,1.4);
      float lineGlow=smoothstep(0.07,0.0,min(Lm,1.4-Lm))*smoothstep(7.0,0.0,L)*0.5/max(rr,0.5);
      accum+=trans*vec3(0.3,0.55,0.9)*lineGlow;
    }

    pos=newPos;
    if(trans<0.02) break;
  }
  if(!hitStar) accum+=trans*starfield(normalize(vel));
  vec3 col=accum/(1.0+accum);
  col=pow(col,vec3(0.4545));
  gl_FragColor=vec4(col,1.0);
}`;
const vert=`void main(){gl_Position=vec4(position.xy,0.0,1.0);}`;
const uni={uRes:{value:new THREE.Vector2()},uTime:{value:0},uCamPos:{value:new THREE.Vector3()},
 uCamBasis:{value:new THREE.Matrix3()},uSpin:{value:4},uTilt:{value:35},uJet:{value:1.1},uOpen:{value:14}};
const mainMat=new THREE.ShaderMaterial({vertexShader:vert,fragmentShader:frag,uniforms:uni});
scene.add(new THREE.Mesh(quad,mainMat));

// ===================== LIGHTWEIGHT MANUAL BLOOM (2-pass) =====================
// No external post-processing lib: bright-pass+blur baked into one pass,
// then additively composited over the sharp scene in a second pass.
const rtOpts={type:THREE.HalfFloatType};
let sceneRT=new THREE.WebGLRenderTarget(2,2,rtOpts);
let bloomRT=new THREE.WebGLRenderTarget(2,2,rtOpts);
const bloomFrag=`precision highp float; uniform sampler2D tex; uniform vec2 uRes;
void main(){ vec2 uv=gl_FragCoord.xy/uRes; vec3 s=vec3(0.0); float tw=0.0;
 for(int x=-3;x<=3;x++)for(int y=-3;y<=3;y++){ vec2 o=vec2(float(x),float(y))*1.6/uRes;
   vec3 c=texture2D(tex,uv+o).rgb; float w=exp(-float(x*x+y*y)*0.18); float br=max(max(c.r,c.g),c.b);
   s+=c*w*smoothstep(0.55,1.2,br); tw+=w; }
 gl_FragColor=vec4(s/tw,1.0); }`;
const compFrag=`precision highp float; uniform sampler2D tex; uniform sampler2D bloom; uniform vec2 uRes;
void main(){ vec2 uv=gl_FragCoord.xy/uRes; vec3 c=texture2D(tex,uv).rgb+texture2D(bloom,uv).rgb*0.9;
 gl_FragColor=vec4(c,1.0); }`;
const bloomMat=new THREE.ShaderMaterial({vertexShader:vert,fragmentShader:bloomFrag,
 uniforms:{tex:{value:null},uRes:{value:new THREE.Vector2()}}});
const compMat=new THREE.ShaderMaterial({vertexShader:vert,fragmentShader:compFrag,
 uniforms:{tex:{value:null},bloom:{value:null},uRes:{value:new THREE.Vector2()}}});
const passScene=new THREE.Scene(); const passMesh=new THREE.Mesh(quad,bloomMat); passScene.add(passMesh);

// ---- orbit camera ----
let az=0.7,el=0.3,dist=8,dragging=false,lastX=0,lastY=0;
canvas.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;});
addEventListener('pointerup',()=>dragging=false);
addEventListener('pointermove',e=>{if(!dragging)return; az-=(e.clientX-lastX)*0.005;
 el=Math.max(-1.3,Math.min(1.3,el+(e.clientY-lastY)*0.005)); lastX=e.clientX; lastY=e.clientY;});
canvas.addEventListener('wheel',e=>{dist=Math.max(2.5,Math.min(30,dist+e.deltaY*0.01));e.preventDefault();},{passive:false});

document.getElementById('spin').addEventListener('input',e=>uni.uSpin.value=parseFloat(e.target.value));
document.getElementById('tilt').addEventListener('input',e=>uni.uTilt.value=parseFloat(e.target.value));
document.getElementById('jet').addEventListener('input',e=>uni.uJet.value=parseFloat(e.target.value));
document.getElementById('open').addEventListener('input',e=>uni.uOpen.value=parseFloat(e.target.value));

function resize(){
  const w=innerWidth,h=innerHeight,pr=renderer.getPixelRatio();
  renderer.setSize(w,h,false);
  uni.uRes.value.set(w*pr,h*pr);
  sceneRT.setSize(w*pr,h*pr); bloomRT.setSize(w*pr,h*pr);
  bloomMat.uniforms.uRes.value.set(w*pr,h*pr); compMat.uniforms.uRes.value.set(w*pr,h*pr);
}
addEventListener('resize',resize); resize();

const clock=new THREE.Clock();
function frame(){
  requestAnimationFrame(frame);
  uni.uTime.value=clock.getElapsedTime();
  const camPos=new THREE.Vector3(dist*Math.cos(el)*Math.sin(az),dist*Math.sin(el),dist*Math.cos(el)*Math.cos(az));
  const fwd=camPos.clone().negate().normalize();
  const right=new THREE.Vector3().crossVectors(fwd,new THREE.Vector3(0,1,0)).normalize();
  const up=new THREE.Vector3().crossVectors(right,fwd).normalize();
  uni.uCamPos.value.copy(camPos);
  uni.uCamBasis.value.set(right.x,up.x,fwd.x, right.y,up.y,fwd.y, right.z,up.z,fwd.z);

  renderer.setRenderTarget(sceneRT); renderer.render(scene,cam);
  passMesh.material=bloomMat; bloomMat.uniforms.tex.value=sceneRT.texture;
  renderer.setRenderTarget(bloomRT); renderer.render(passScene,cam);
  passMesh.material=compMat; compMat.uniforms.tex.value=sceneRT.texture; compMat.uniforms.bloom.value=bloomRT.texture;
  renderer.setRenderTarget(null); renderer.render(passScene,cam);
}
frame();