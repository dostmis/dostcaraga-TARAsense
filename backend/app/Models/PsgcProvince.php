<?php

namespace App\Models;

class PsgcProvince extends PrismaModel
{
    protected $table = 'psgc_provinces';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = ['id', 'code', 'name', 'regionId'];

    public function region()
    {
        return $this->belongsTo(PsgcRegion::class, 'regionId');
    }

    public function cities()
    {
        return $this->hasMany(PsgcCity::class, 'provinceId');
    }

    public function userProfiles()
    {
        return $this->hasMany(UserProfile::class, 'provinceId');
    }

    public function studyTargets()
    {
        return $this->hasMany(StudyLocationTarget::class, 'provinceId');
    }
}
